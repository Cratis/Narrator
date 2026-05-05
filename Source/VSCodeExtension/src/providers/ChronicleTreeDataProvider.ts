import * as vscode from 'vscode';
import { ChronicleClientManager } from '../ChronicleClientManager';

type ItemType =
    | 'context'
    | 'eventStore'
    | 'namespace'
    | 'observersFolder'
    | 'observer'
    | 'error'
    | 'loading'
    | 'noConnection'
    | 'empty';

export class ChronicleTreeItem extends vscode.TreeItem {
    readonly itemType: ItemType;
    readonly contextName?: string;
    readonly eventStoreName?: string;
    readonly namespaceName?: string;

    constructor(
        label: string,
        itemType: ItemType,
        collapsibleState: vscode.TreeItemCollapsibleState,
        opts?: {
            contextName?: string;
            eventStoreName?: string;
            namespaceName?: string;
        }
    ) {
        super(label, collapsibleState);
        this.itemType = itemType;
        this.contextName = opts?.contextName;
        this.eventStoreName = opts?.eventStoreName;
        this.namespaceName = opts?.namespaceName;

        switch (itemType) {
            case 'context':
                this.iconPath = new vscode.ThemeIcon('account');
                break;
            case 'eventStore':
                this.iconPath = new vscode.ThemeIcon('database');
                break;
            case 'namespace':
                this.iconPath = new vscode.ThemeIcon('folder');
                break;
            case 'observersFolder':
                this.iconPath = new vscode.ThemeIcon('eye');
                break;
            case 'observer':
                this.iconPath = new vscode.ThemeIcon('pulse');
                break;
            case 'error':
                this.iconPath = new vscode.ThemeIcon('error');
                break;
            case 'loading':
                this.iconPath = new vscode.ThemeIcon('loading~spin');
                break;
            case 'noConnection':
                this.iconPath = new vscode.ThemeIcon('plug');
                this.command = {
                    command: 'narrator.connect',
                    title: 'Connect to Chronicle',
                };
                break;
            case 'empty':
                this.iconPath = new vscode.ThemeIcon('info');
                break;
        }
    }
}

export class ChronicleTreeDataProvider implements vscode.TreeDataProvider<ChronicleTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<ChronicleTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private _clientManager: ChronicleClientManager | undefined;
    private _activeContextName: string | undefined;

    constructor(clientManager: ChronicleClientManager | undefined, activeContextName?: string) {
        this._clientManager = clientManager;
        this._activeContextName = activeContextName;
    }

    setClientManager(manager: ChronicleClientManager | undefined, activeContextName?: string): void {
        this._clientManager = manager;
        this._activeContextName = activeContextName;
        this.refresh();
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ChronicleTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: ChronicleTreeItem): Promise<ChronicleTreeItem[]> {
        if (!element) {
            return this._getRootChildren();
        }

        switch (element.itemType) {
            case 'context':
                return this._getEventStores();
            case 'eventStore':
                return this._getNamespaces(element.eventStoreName!);
            case 'namespace':
                return [
                    new ChronicleTreeItem(
                        'Observers',
                        'observersFolder',
                        vscode.TreeItemCollapsibleState.Collapsed,
                        {
                            eventStoreName: element.eventStoreName,
                            namespaceName: element.namespaceName,
                        }
                    ),
                ];
            case 'observersFolder':
                return this._getObservers(element.eventStoreName!, element.namespaceName!);
            default:
                return [];
        }
    }

    private _getRootChildren(): ChronicleTreeItem[] {
        if (!this._clientManager?.isConnected) {
            return [
                new ChronicleTreeItem(
                    'Not connected - click to configure',
                    'noConnection',
                    vscode.TreeItemCollapsibleState.None
                ),
            ];
        }

        const contextLabel = `Active Context: ${this._activeContextName ?? 'default'}`;
        return [
            new ChronicleTreeItem(
                contextLabel,
                'context',
                vscode.TreeItemCollapsibleState.Collapsed,
                { contextName: this._activeContextName }
            ),
        ];
    }

    private async _getEventStores(): Promise<ChronicleTreeItem[]> {
        if (!this._clientManager) {
            return [];
        }
        try {
            const stores = await this._clientManager.listEventStores();
            if (stores.length === 0) {
                return [new ChronicleTreeItem('No items found', 'empty', vscode.TreeItemCollapsibleState.None)];
            }
            return stores.map(
                (name) =>
                    new ChronicleTreeItem(name, 'eventStore', vscode.TreeItemCollapsibleState.Collapsed, {
                        eventStoreName: name,
                    })
            );
        } catch (err) {
            return [
                new ChronicleTreeItem(
                    `Error: ${err instanceof Error ? err.message : String(err)}`,
                    'error',
                    vscode.TreeItemCollapsibleState.None
                ),
            ];
        }
    }

    private async _getNamespaces(eventStoreName: string): Promise<ChronicleTreeItem[]> {
        if (!this._clientManager) {
            return [];
        }
        try {
            const namespaces = await this._clientManager.listNamespaces(eventStoreName);
            if (namespaces.length === 0) {
                return [new ChronicleTreeItem('No items found', 'empty', vscode.TreeItemCollapsibleState.None)];
            }
            return namespaces.map(
                (name) =>
                    new ChronicleTreeItem(name, 'namespace', vscode.TreeItemCollapsibleState.Collapsed, {
                        eventStoreName,
                        namespaceName: name,
                    })
            );
        } catch (err) {
            return [
                new ChronicleTreeItem(
                    `Error: ${err instanceof Error ? err.message : String(err)}`,
                    'error',
                    vscode.TreeItemCollapsibleState.None
                ),
            ];
        }
    }

    private async _getObservers(eventStoreName: string, namespaceName: string): Promise<ChronicleTreeItem[]> {
        if (!this._clientManager) {
            return [];
        }
        try {
            const observers = await this._clientManager.listObservers(eventStoreName, namespaceName);
            if (observers.length === 0) {
                return [new ChronicleTreeItem('No items found', 'empty', vscode.TreeItemCollapsibleState.None)];
            }
            return observers.map(
                (name) => new ChronicleTreeItem(name, 'observer', vscode.TreeItemCollapsibleState.None)
            );
        } catch (err) {
            return [
                new ChronicleTreeItem(
                    `Error: ${err instanceof Error ? err.message : String(err)}`,
                    'error',
                    vscode.TreeItemCollapsibleState.None
                ),
            ];
        }
    }
}
