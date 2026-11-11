// Copyright (c) Cratis. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

import * as vscode from 'vscode';
import { Configuration, loadConfiguration, saveConfiguration, getConfigPath } from './Configuration';
import { ChronicleClientManager } from './ChronicleClientManager';
import { ChronicleTreeDataProvider } from './providers/ChronicleTreeDataProvider';
import { updateStatusBar } from './StatusBar';

/**
 * Shared mutable state for the active connection, passed by reference across command handlers.
 */
export interface ExtensionState {
    clientManager: ChronicleClientManager | undefined;
    activeContextName: string | undefined;
    outputChannel: vscode.OutputChannel;
}

interface SwitchOptions {
    /** Show the "Switched to context" message after a successful connection. */
    announce?: boolean;
    failureMessage?: (reason: string) => string;
}

/** Everything a command handler needs to read, change and refresh the connection state. */
interface CommandScope {
    state: ExtensionState;
    statusBar: vscode.StatusBarItem;
    treeDataProvider: ChronicleTreeDataProvider;
    getEffectiveConfigPath: () => string | undefined;
}

const requiredInput = (message: string) => (value?: string) => (!value?.trim() ? message : undefined);

function contextNameOf(item?: vscode.TreeItem): string | undefined {
    return typeof item?.label === 'string' ? item.label : undefined;
}

/** Replaces the client manager with one for the named context, connects it and refreshes the UI. */
async function switchTo(
    scope: CommandScope,
    contextName: string,
    config: Configuration,
    options: SwitchOptions = {}
): Promise<void> {
    const { state, statusBar, treeDataProvider } = scope;
    state.clientManager?.disconnect();
    state.clientManager = new ChronicleClientManager(contextName, config.contexts[contextName], state.outputChannel);
    state.activeContextName = contextName;
    updateStatusBar(statusBar, contextName, false, true);
    try {
        await state.clientManager.connect();
        treeDataProvider.setClientManager(state.clientManager, contextName, config);
        updateStatusBar(statusBar, contextName, true);
        if (options.announce) {
            vscode.window.showInformationMessage(`Switched to context: ${contextName}`);
        }
    } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        treeDataProvider.setClientManager(undefined, contextName, config);
        updateStatusBar(statusBar, contextName, false);
        const failureMessage = options.failureMessage ?? (r => `Failed to connect: ${r}`);
        vscode.window.showErrorMessage(failureMessage(reason));
    }
}

function refreshTree(scope: CommandScope, config: Configuration): void {
    scope.treeDataProvider.setClientManager(scope.state.clientManager, scope.state.activeContextName, config);
}

async function shouldActivateNewContext(config: Configuration, name: string): Promise<boolean> {
    if (config.activeContext === name) { return true; }
    const answer = await vscode.window.showQuickPick(['Yes', 'No'], {
        placeHolder: `Set "${name}" as the active context?`,
    });
    return answer === 'Yes';
}

async function addContext(scope: CommandScope, prefillName?: string): Promise<void> {
    const name = await vscode.window.showInputBox({
        title: 'Add Chronicle Context (1/2)',
        prompt: 'Context name',
        value: prefillName ?? '',
        placeHolder: 'default',
        validateInput: requiredInput('Name is required'),
    });
    if (!name) { return; }

    const server = await vscode.window.showInputBox({
        title: 'Add Chronicle Context (2/2)',
        prompt: 'Chronicle server URL',
        placeHolder: 'chronicle://localhost:35000',
        validateInput: requiredInput('Server URL is required'),
    });
    if (!server) { return; }

    const contextName = name.trim();
    const freshConfig = loadConfiguration(scope.getEffectiveConfigPath());
    freshConfig.contexts[contextName] = {
        server: server.trim(),
    };
    if (!freshConfig.activeContext) {
        freshConfig.activeContext = contextName;
    }
    saveConfiguration(freshConfig, scope.getEffectiveConfigPath());

    if (await shouldActivateNewContext(freshConfig, contextName)) {
        freshConfig.activeContext = contextName;
        saveConfiguration(freshConfig, scope.getEffectiveConfigPath());
        await switchTo(scope, contextName, freshConfig);
    } else {
        refreshTree(scope, freshConfig);
    }
}

async function setContext(scope: CommandScope): Promise<void> {
    const currentConfig = loadConfiguration(scope.getEffectiveConfigPath());
    const contextNames = Object.keys(currentConfig.contexts);
    if (contextNames.length === 0) {
        const configLocation = scope.getEffectiveConfigPath() ?? getConfigPath();
        vscode.window.showWarningMessage(`No contexts found in ${configLocation}`);
        return;
    }

    const selected = await vscode.window.showQuickPick(contextNames, {
        placeHolder: 'Select active context',
    });
    if (!selected) { return; }

    currentConfig.activeContext = selected;
    saveConfiguration(currentConfig, scope.getEffectiveConfigPath());

    await switchTo(scope, selected, currentConfig, {
        announce: true,
        failureMessage: reason => `Failed to connect to context "${selected}": ${reason}`,
    });
}

async function editContext(scope: CommandScope, item?: vscode.TreeItem): Promise<void> {
    const contextName = contextNameOf(item);
    if (!contextName) { return; }

    const freshConfig = loadConfiguration(scope.getEffectiveConfigPath());
    const ctx = freshConfig.contexts[contextName];
    if (!ctx) { return; }

    const server = await vscode.window.showInputBox({
        title: `Edit Context: ${contextName}`,
        prompt: 'Chronicle server URL',
        value: ctx.server ?? '',
        validateInput: requiredInput('Server URL is required'),
    });
    if (server === undefined) { return; }

    ctx.server = server.trim();
    saveConfiguration(freshConfig, scope.getEffectiveConfigPath());

    if (contextName === scope.state.activeContextName) {
        await switchTo(scope, contextName, freshConfig);
    } else {
        refreshTree(scope, freshConfig);
    }
}

function removeContext(config: Configuration, contextName: string): void {
    delete config.contexts[contextName];
    if (config.activeContext === contextName) {
        const remaining = Object.keys(config.contexts);
        config.activeContext = remaining.length > 0 ? remaining[0] : undefined;
    }
}

function disconnectActiveContext(scope: CommandScope, config: Configuration): void {
    const { state, statusBar } = scope;
    state.clientManager?.disconnect();
    state.clientManager = undefined;
    state.activeContextName = config.activeContext;
    updateStatusBar(statusBar, state.activeContextName, false);
}

async function deleteContext(scope: CommandScope, item?: vscode.TreeItem): Promise<void> {
    const contextName = contextNameOf(item);
    if (!contextName) { return; }

    const confirmed = await vscode.window.showWarningMessage(
        `Delete context "${contextName}"?`,
        { modal: true },
        'Delete'
    );
    if (confirmed !== 'Delete') { return; }

    const freshConfig = loadConfiguration(scope.getEffectiveConfigPath());
    removeContext(freshConfig, contextName);
    saveConfiguration(freshConfig, scope.getEffectiveConfigPath());

    if (contextName === scope.state.activeContextName) {
        disconnectActiveContext(scope, freshConfig);
    }
    refreshTree(scope, freshConfig);
}

async function activateContext(scope: CommandScope, item?: vscode.TreeItem): Promise<void> {
    const contextName = contextNameOf(item);
    if (!contextName) { return; }

    const freshConfig = loadConfiguration(scope.getEffectiveConfigPath());
    if (!freshConfig.contexts[contextName]) { return; }

    freshConfig.activeContext = contextName;
    saveConfiguration(freshConfig, scope.getEffectiveConfigPath());

    await switchTo(scope, contextName, freshConfig, { announce: true });
}

/**
 * Registers all context-management commands and returns their disposables.
 */
export function registerContextCommands(
    state: ExtensionState,
    statusBar: vscode.StatusBarItem,
    treeDataProvider: ChronicleTreeDataProvider,
    getEffectiveConfigPath: () => string | undefined
): vscode.Disposable[] {
    const scope: CommandScope = { state, statusBar, treeDataProvider, getEffectiveConfigPath };

    return [
        vscode.commands.registerCommand('narrator.setContext', () => setContext(scope)),
        vscode.commands.registerCommand('narrator.addContext', () => addContext(scope)),
        vscode.commands.registerCommand('narrator.editContext', (item?: vscode.TreeItem) => editContext(scope, item)),
        vscode.commands.registerCommand('narrator.deleteContext', (item?: vscode.TreeItem) => deleteContext(scope, item)),
        vscode.commands.registerCommand('narrator.activateContext', (item?: vscode.TreeItem) => activateContext(scope, item)),
    ];
}
