import * as vscode from 'vscode';
import { loadCliConfiguration, saveCliConfiguration, getConfigPath, CliConfiguration } from './CliConfiguration';
import { ChronicleClientManager } from './ChronicleClientManager';
import { ChronicleTreeDataProvider } from './providers/ChronicleTreeDataProvider';

let clientManager: ChronicleClientManager | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    let config = loadCliConfiguration();
    let activeContextName = config.activeContext;
    let activeContext = activeContextName ? config.contexts[activeContextName] : undefined;

    if (!activeContextName && Object.keys(config.contexts).length > 0) {
        activeContextName = Object.keys(config.contexts)[0];
        activeContext = config.contexts[activeContextName];
    }

    if (activeContext) {
        clientManager = new ChronicleClientManager(activeContext);
        try {
            await clientManager.connect();
        } catch {
            // Silently ignore connection errors on startup
        }
    }

    const treeDataProvider = new ChronicleTreeDataProvider(clientManager, activeContextName);
    const treeView = vscode.window.createTreeView('narratorExplorer', {
        treeDataProvider,
        showCollapseAll: true,
    });

    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBar.command = 'narrator.setContext';
    updateStatusBar(statusBar, activeContextName, clientManager?.isConnected ?? false);
    statusBar.show();

    const refreshCmd = vscode.commands.registerCommand('narrator.refresh', () => {
        treeDataProvider.refresh();
    });

    const connectCmd = vscode.commands.registerCommand('narrator.connect', async () => {
        let currentConfig = loadCliConfiguration();
        let ctxName = currentConfig.activeContext;
        let ctx = ctxName ? currentConfig.contexts[ctxName] : undefined;

        if (!ctxName && Object.keys(currentConfig.contexts).length > 0) {
            ctxName = Object.keys(currentConfig.contexts)[0];
            ctx = currentConfig.contexts[ctxName];
        }

        if (!ctx?.server) {
            const server = await vscode.window.showInputBox({
                prompt: 'Enter Chronicle server URL',
                placeHolder: 'chronicle://localhost:35000',
            });
            if (!server) {
                return;
            }
            if (!ctxName) {
                ctxName = 'default';
                currentConfig.contexts[ctxName] = {};
                currentConfig.activeContext = ctxName;
            }
            currentConfig.contexts[ctxName].server = server;
            saveCliConfiguration(currentConfig);
            ctx = currentConfig.contexts[ctxName];
        }

        clientManager?.disconnect();
        clientManager = new ChronicleClientManager(ctx!);
        updateStatusBar(statusBar, ctxName, false, true);
        try {
            await clientManager.connect();
            treeDataProvider.setClientManager(clientManager, ctxName);
            updateStatusBar(statusBar, ctxName, true);
            vscode.window.showInformationMessage(`Connected to Chronicle (${ctxName})`);
        } catch (err) {
            treeDataProvider.setClientManager(undefined);
            updateStatusBar(statusBar, ctxName, false);
            vscode.window.showErrorMessage(`Failed to connect: ${err instanceof Error ? err.message : String(err)}`);
        }
    });

    const setContextCmd = vscode.commands.registerCommand('narrator.setContext', async () => {
        const currentConfig = loadCliConfiguration();
        const contextNames = Object.keys(currentConfig.contexts);
        if (contextNames.length === 0) {
            vscode.window.showWarningMessage('No contexts found in ~/.cratis/config.json');
            return;
        }

        const selected = await vscode.window.showQuickPick(contextNames, {
            placeHolder: 'Select active context',
        });
        if (!selected) {
            return;
        }

        currentConfig.activeContext = selected;
        saveCliConfiguration(currentConfig);

        const newContext = currentConfig.contexts[selected];
        clientManager?.disconnect();
        clientManager = new ChronicleClientManager(newContext);
        updateStatusBar(statusBar, selected, false, true);
        try {
            await clientManager.connect();
            treeDataProvider.setClientManager(clientManager, selected);
            updateStatusBar(statusBar, selected, true);
            vscode.window.showInformationMessage(`Switched to context: ${selected}`);
        } catch (err) {
            treeDataProvider.setClientManager(undefined);
            updateStatusBar(statusBar, selected, false);
            vscode.window.showErrorMessage(`Failed to connect to context "${selected}": ${err instanceof Error ? err.message : String(err)}`);
        }
    });

    const openSettingsCmd = vscode.commands.registerCommand('narrator.openSettings', () => {
        vscode.commands.executeCommand('workbench.action.openSettings', 'narrator');
    });

    const configWatcher = vscode.workspace.createFileSystemWatcher(getConfigPath());
    configWatcher.onDidChange(async () => {
        const updatedConfig = loadCliConfiguration();
        const ctxName = updatedConfig.activeContext;
        const ctx = ctxName ? updatedConfig.contexts[ctxName] : undefined;
        if (ctx) {
            clientManager?.disconnect();
            clientManager = new ChronicleClientManager(ctx);
            try {
                await clientManager.connect();
            } catch {
                // Ignore
            }
            treeDataProvider.setClientManager(clientManager, ctxName);
            updateStatusBar(statusBar, ctxName, clientManager.isConnected);
        }
    });

    context.subscriptions.push(
        treeView,
        statusBar,
        refreshCmd,
        connectCmd,
        setContextCmd,
        openSettingsCmd,
        configWatcher
    );
}

export function deactivate(): void {
    clientManager?.disconnect();
    clientManager = undefined;
}

function updateStatusBar(
    item: vscode.StatusBarItem,
    contextName: string | undefined,
    connected: boolean,
    connecting = false
): void {
    const name = contextName ?? 'default';
    if (connecting) {
        item.text = `$(plug~spin) Chronicle: Connecting...`;
    } else {
        item.text = `$(plug) Chronicle: ${name}`;
    }
    item.tooltip = connected ? `Connected to Chronicle (${name})` : `Not connected (${name})`;
}
