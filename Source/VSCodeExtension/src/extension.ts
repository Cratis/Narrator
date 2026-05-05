import * as vscode from 'vscode';
import { loadCliConfiguration, saveCliConfiguration, getConfigPath, CliConfiguration, CliContext } from './CliConfiguration';
import { ChronicleClientManager } from './ChronicleClientManager';
import { ChronicleTreeDataProvider } from './providers/ChronicleTreeDataProvider';

let clientManager: ChronicleClientManager | undefined;

function resolveActiveContext(config: CliConfiguration): { ctxName: string | undefined; ctx: CliContext | undefined } {
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
    let config = loadCliConfiguration(getEffectiveConfigPath());
    const { ctxName: initialCtxName, ctx: initialCtx } = resolveActiveContext(config);
    let activeContextName = initialCtxName;

    if (initialCtx) {
        clientManager = new ChronicleClientManager(initialCtx);
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
        let currentConfig = loadCliConfiguration(getEffectiveConfigPath());
        let { ctxName, ctx } = resolveActiveContext(currentConfig);

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
            saveCliConfiguration(currentConfig, getEffectiveConfigPath());
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
        const currentConfig = loadCliConfiguration(getEffectiveConfigPath());
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
        saveCliConfiguration(currentConfig, getEffectiveConfigPath());

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

    const effectiveConfigPath = getEffectiveConfigPath() ?? getConfigPath();
    const configWatcher = vscode.workspace.createFileSystemWatcher(effectiveConfigPath);
    configWatcher.onDidChange(async () => {
        const updatedConfig = loadCliConfiguration(getEffectiveConfigPath());
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
        item.tooltip = `Connecting to Chronicle (${name})`;
    } else if (connected) {
        item.text = `$(plug) Chronicle: ${name}`;
        item.tooltip = `Connected to Chronicle (${name})`;
    } else {
        item.text = `$(debug-disconnect) Chronicle: ${name}`;
        item.tooltip = `Not connected to Chronicle (${name}) — click to switch context`;
    }
}
