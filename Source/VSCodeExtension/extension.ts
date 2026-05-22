// Copyright (c) Cratis. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

import * as vscode from 'vscode';
import { loadConfiguration, saveConfiguration, getConfigPath, Configuration, Context } from './Configuration';
import { ChronicleClientManager } from './ChronicleClientManager';
import { ChronicleTreeDataProvider, ChronicleTreeItem } from './providers/ChronicleTreeDataProvider';
import { DetailsTreeDataProvider } from './providers/DetailsTreeDataProvider';
import { updateStatusBar } from './StatusBar';
import { ExtensionState, registerContextCommands } from './ContextCommands';
import { registerEditorCommands } from './EditorCommands';

let _state: ExtensionState | undefined;

function resolveActiveContext(config: Configuration): { ctxName: string | undefined; ctx: Context | undefined } {
    let ctxName = config.activeContext;
    let ctx = ctxName ? config.contexts[ctxName] : undefined;
    if (!ctxName && Object.keys(config.contexts).length > 0) {
        ctxName = Object.keys(config.contexts)[0];
        ctx = config.contexts[ctxName];
    }
    return { ctxName, ctx };
}

function getEffectiveConfigPath(): string | undefined {
    const setting = vscode.workspace.getConfiguration('narrator').get<string>('configPath');
    return setting && setting.trim() !== '' ? setting.trim() : undefined;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const outputChannel = vscode.window.createOutputChannel('Chronicle');
    outputChannel.appendLine('Narrator extension activated');
    context.subscriptions.push(outputChannel);

    const config = loadConfiguration(getEffectiveConfigPath());
    const { ctxName: initialCtxName, ctx: initialCtx } = resolveActiveContext(config);

    _state = {
        clientManager: undefined,
        activeContextName: initialCtxName,
        outputChannel,
    };

    if (initialCtx) {
        _state.clientManager = new ChronicleClientManager(initialCtxName!, initialCtx, outputChannel);
        try {
            await _state.clientManager.connect();
        } catch (err) {
            outputChannel.appendLine(`[Chronicle] Startup connection error: ${err}`);
        }
    }

    const treeDataProvider = new ChronicleTreeDataProvider(_state.clientManager, _state.activeContextName, config);
    const treeView = vscode.window.createTreeView('narratorExplorer', {
        treeDataProvider,
        showCollapseAll: true,
    });

    const detailsProvider = new DetailsTreeDataProvider();
    const detailsView = vscode.window.createTreeView('narratorDetails', {
        treeDataProvider: detailsProvider,
        showCollapseAll: true,
    });

    treeView.onDidChangeSelection((event) => {
        const selected = event.selection.find((item): item is ChronicleTreeItem => item instanceof ChronicleTreeItem);
        detailsProvider.show(selected?.details);
    });

    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBar.command = 'narrator.setContext';
    updateStatusBar(statusBar, _state.activeContextName, _state.clientManager?.isConnected ?? false);
    statusBar.show();

    const refreshCmd = vscode.commands.registerCommand('narrator.refresh', () => {
        treeDataProvider.refresh();
    });

    const connectCmd = vscode.commands.registerCommand('narrator.connect', async () => {
        const currentConfig = loadConfiguration(getEffectiveConfigPath());
        let { ctxName, ctx } = resolveActiveContext(currentConfig);

        if (!ctx?.server) {
            const server = await vscode.window.showInputBox({
                prompt: 'Enter Chronicle server URL',
                placeHolder: 'chronicle://localhost:35000',
            });
            if (!server) { return; }
            if (!ctxName) {
                ctxName = 'default';
                currentConfig.contexts[ctxName] = {};
                currentConfig.activeContext = ctxName;
            }
            currentConfig.contexts[ctxName].server = server;
            saveConfiguration(currentConfig, getEffectiveConfigPath());
            ctx = currentConfig.contexts[ctxName];
        }

        _state!.clientManager?.disconnect();
        _state!.clientManager = new ChronicleClientManager(ctxName!, ctx!, outputChannel);
        updateStatusBar(statusBar, ctxName, false, true);
        try {
            await _state!.clientManager.connect();
            treeDataProvider.setClientManager(_state!.clientManager, ctxName);
            updateStatusBar(statusBar, ctxName, true);
            vscode.window.showInformationMessage(`Connected to Chronicle (${ctxName})`);
        } catch (err) {
            outputChannel.appendLine(`[Chronicle] Connect error: ${err}`);
            treeDataProvider.setClientManager(undefined, undefined, currentConfig);
            updateStatusBar(statusBar, ctxName, false);
            vscode.window.showErrorMessage(`Failed to connect: ${err instanceof Error ? err.message : String(err)}`);
        }
    });

    const openSettingsCmd = vscode.commands.registerCommand('narrator.openSettings', () => {
        vscode.commands.executeCommand('workbench.action.openSettings', 'narrator');
    });

    const contextDisposables = registerContextCommands(_state, statusBar, treeDataProvider, getEffectiveConfigPath);
    const editorDisposables = registerEditorCommands(() => _state?.clientManager);

    if (Object.keys(config.contexts).length === 0) {
        vscode.window.showInformationMessage(
            'No Chronicle contexts found. Add one to get started.',
            'Add Context'
        ).then(choice => {
            if (choice === 'Add Context') {
                vscode.commands.executeCommand('narrator.addContext');
            }
        });
    }

    const effectiveConfigPath = getEffectiveConfigPath() ?? getConfigPath();
    const configWatcher = vscode.workspace.createFileSystemWatcher(effectiveConfigPath);
    configWatcher.onDidChange(async () => {
        const updatedConfig = loadConfiguration(getEffectiveConfigPath());
        const ctxName = updatedConfig.activeContext;
        const ctx = ctxName ? updatedConfig.contexts[ctxName] : undefined;
        if (ctx && ctxName) {
            _state!.clientManager?.disconnect();
            _state!.clientManager = new ChronicleClientManager(ctxName, ctx, outputChannel);
            try {
                await _state!.clientManager.connect();
            } catch (err) {
                outputChannel.appendLine(`[Chronicle] Config watcher reconnect error: ${err}`);
            }
            treeDataProvider.setClientManager(_state!.clientManager, ctxName, updatedConfig);
            updateStatusBar(statusBar, ctxName, _state!.clientManager.isConnected);
        }
    });

    context.subscriptions.push(
        treeView,
        detailsView,
        statusBar,
        refreshCmd,
        connectCmd,
        openSettingsCmd,
        ...contextDisposables,
        ...editorDisposables,
        configWatcher
    );
}

export function deactivate(): void {
    _state?.clientManager?.disconnect();
    _state = undefined;
}
