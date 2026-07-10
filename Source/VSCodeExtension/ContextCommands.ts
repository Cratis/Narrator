// Copyright (c) Cratis. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

import * as vscode from 'vscode';
import { loadConfiguration, saveConfiguration, getConfigPath } from './Configuration';
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

/**
 * Registers all context-management commands and returns their disposables.
 */
export function registerContextCommands(
    state: ExtensionState,
    statusBar: vscode.StatusBarItem,
    treeDataProvider: ChronicleTreeDataProvider,
    getEffectiveConfigPath: () => string | undefined
): vscode.Disposable[] {
    async function runAddContextFlow(prefillName?: string): Promise<void> {
        const name = await vscode.window.showInputBox({
            title: 'Add Chronicle Context (1/2)',
            prompt: 'Context name',
            value: prefillName ?? '',
            placeHolder: 'default',
            validateInput: v => (!v?.trim() ? 'Name is required' : undefined),
        });
        if (!name) { return; }

        const server = await vscode.window.showInputBox({
            title: 'Add Chronicle Context (2/2)',
            prompt: 'Chronicle server URL',
            placeHolder: 'chronicle://localhost:35000',
            validateInput: v => (!v?.trim() ? 'Server URL is required' : undefined),
        });
        if (!server) { return; }

        const freshConfig = loadConfiguration(getEffectiveConfigPath());
        freshConfig.contexts[name.trim()] = {
            server: server.trim(),
        };
        if (!freshConfig.activeContext) {
            freshConfig.activeContext = name.trim();
        }
        saveConfiguration(freshConfig, getEffectiveConfigPath());

        const shouldActivate = freshConfig.activeContext === name.trim() ||
            await vscode.window.showQuickPick(['Yes', 'No'], {
                placeHolder: `Set "${name.trim()}" as the active context?`,
            }) === 'Yes';

        if (shouldActivate) {
            freshConfig.activeContext = name.trim();
            saveConfiguration(freshConfig, getEffectiveConfigPath());
            const ctx = freshConfig.contexts[name.trim()];
            state.clientManager?.disconnect();
            state.clientManager = new ChronicleClientManager(name.trim(), ctx, state.outputChannel);
            state.activeContextName = name.trim();
            updateStatusBar(statusBar, state.activeContextName, false, true);
            try {
                await state.clientManager.connect();
                treeDataProvider.setClientManager(state.clientManager, state.activeContextName, freshConfig);
                updateStatusBar(statusBar, state.activeContextName, true);
            } catch (err) {
                treeDataProvider.setClientManager(undefined, state.activeContextName, freshConfig);
                updateStatusBar(statusBar, state.activeContextName, false);
                vscode.window.showErrorMessage(`Failed to connect: ${err instanceof Error ? err.message : String(err)}`);
            }
        } else {
            treeDataProvider.setClientManager(state.clientManager, state.activeContextName, freshConfig);
        }
    }

    const setContextCmd = vscode.commands.registerCommand('narrator.setContext', async () => {
        const currentConfig = loadConfiguration(getEffectiveConfigPath());
        const contextNames = Object.keys(currentConfig.contexts);
        if (contextNames.length === 0) {
            const configLocation = getEffectiveConfigPath() ?? getConfigPath();
            vscode.window.showWarningMessage(`No contexts found in ${configLocation}`);
            return;
        }

        const selected = await vscode.window.showQuickPick(contextNames, {
            placeHolder: 'Select active context',
        });
        if (!selected) { return; }

        currentConfig.activeContext = selected;
        saveConfiguration(currentConfig, getEffectiveConfigPath());

        const newContext = currentConfig.contexts[selected];
        state.clientManager?.disconnect();
        state.clientManager = new ChronicleClientManager(selected, newContext, state.outputChannel);
        state.activeContextName = selected;
        updateStatusBar(statusBar, selected, false, true);
        try {
            await state.clientManager.connect();
            treeDataProvider.setClientManager(state.clientManager, selected, currentConfig);
            updateStatusBar(statusBar, selected, true);
            vscode.window.showInformationMessage(`Switched to context: ${selected}`);
        } catch (err) {
            treeDataProvider.setClientManager(undefined, selected, currentConfig);
            updateStatusBar(statusBar, selected, false);
            vscode.window.showErrorMessage(`Failed to connect to context "${selected}": ${err instanceof Error ? err.message : String(err)}`);
        }
    });

    const addContextCmd = vscode.commands.registerCommand('narrator.addContext', () => runAddContextFlow());

    const editContextCmd = vscode.commands.registerCommand('narrator.editContext', async (item?: vscode.TreeItem) => {
        const contextName = typeof item?.label === 'string' ? item.label : undefined;
        if (!contextName) { return; }

        const freshConfig = loadConfiguration(getEffectiveConfigPath());
        const ctx = freshConfig.contexts[contextName];
        if (!ctx) { return; }

        const server = await vscode.window.showInputBox({
            title: `Edit Context: ${contextName}`,
            prompt: 'Chronicle server URL',
            value: ctx.server ?? '',
            validateInput: v => (!v?.trim() ? 'Server URL is required' : undefined),
        });
        if (server === undefined) { return; }

        ctx.server = server.trim();
        saveConfiguration(freshConfig, getEffectiveConfigPath());

        if (contextName === state.activeContextName) {
            state.clientManager?.disconnect();
            state.clientManager = new ChronicleClientManager(contextName, ctx, state.outputChannel);
            updateStatusBar(statusBar, contextName, false, true);
            try {
                await state.clientManager.connect();
                treeDataProvider.setClientManager(state.clientManager, state.activeContextName, freshConfig);
                updateStatusBar(statusBar, contextName, true);
            } catch (err) {
                treeDataProvider.setClientManager(undefined, state.activeContextName, freshConfig);
                updateStatusBar(statusBar, contextName, false);
                vscode.window.showErrorMessage(`Failed to connect: ${err instanceof Error ? err.message : String(err)}`);
            }
        } else {
            treeDataProvider.setClientManager(state.clientManager, state.activeContextName, freshConfig);
        }
    });

    const deleteContextCmd = vscode.commands.registerCommand('narrator.deleteContext', async (item?: vscode.TreeItem) => {
        const contextName = typeof item?.label === 'string' ? item.label : undefined;
        if (!contextName) { return; }

        const confirmed = await vscode.window.showWarningMessage(
            `Delete context "${contextName}"?`,
            { modal: true },
            'Delete'
        );
        if (confirmed !== 'Delete') { return; }

        const freshConfig = loadConfiguration(getEffectiveConfigPath());
        delete freshConfig.contexts[contextName];
        if (freshConfig.activeContext === contextName) {
            const remaining = Object.keys(freshConfig.contexts);
            freshConfig.activeContext = remaining.length > 0 ? remaining[0] : undefined;
        }
        saveConfiguration(freshConfig, getEffectiveConfigPath());

        if (contextName === state.activeContextName) {
            state.clientManager?.disconnect();
            state.clientManager = undefined;
            state.activeContextName = freshConfig.activeContext;
            updateStatusBar(statusBar, state.activeContextName, false);
        }
        treeDataProvider.setClientManager(state.clientManager, state.activeContextName, freshConfig);
    });

    const activateContextCmd = vscode.commands.registerCommand('narrator.activateContext', async (item?: vscode.TreeItem) => {
        const contextName = typeof item?.label === 'string' ? item.label : undefined;
        if (!contextName) { return; }

        const freshConfig = loadConfiguration(getEffectiveConfigPath());
        const ctx = freshConfig.contexts[contextName];
        if (!ctx) { return; }

        freshConfig.activeContext = contextName;
        saveConfiguration(freshConfig, getEffectiveConfigPath());

        state.clientManager?.disconnect();
        state.clientManager = new ChronicleClientManager(contextName, ctx, state.outputChannel);
        state.activeContextName = contextName;
        updateStatusBar(statusBar, contextName, false, true);
        try {
            await state.clientManager.connect();
            treeDataProvider.setClientManager(state.clientManager, state.activeContextName, freshConfig);
            updateStatusBar(statusBar, contextName, true);
            vscode.window.showInformationMessage(`Switched to context: ${contextName}`);
        } catch (err) {
            treeDataProvider.setClientManager(undefined, state.activeContextName, freshConfig);
            updateStatusBar(statusBar, contextName, false);
            vscode.window.showErrorMessage(`Failed to connect: ${err instanceof Error ? err.message : String(err)}`);
        }
    });

    return [setContextCmd, addContextCmd, editContextCmd, deleteContextCmd, activateContextCmd];
}
