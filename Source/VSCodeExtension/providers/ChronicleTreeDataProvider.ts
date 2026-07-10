// Copyright (c) Cratis. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

import * as vscode from 'vscode';
import { ChronicleClientManager } from '../ChronicleClientManager';
import { Configuration } from '../Configuration';

// ── Item types ───────────────────────────────────────────────────────────────

type ItemType =
    // Root / structural
    | 'context'
    | 'eventStore'
    // Namespace container
    | 'namespace'
    // Namespace-scoped category folders
    | 'recommendationsFolder'
    | 'jobsFolder'
    | 'sequencesFolder'
    | 'observersFolder'
    | 'failedPartitionsFolder'
    | 'readModelsFolder'
    | 'identitiesFolder'
    | 'seedDataFolder'
    // General (event-store level) container
    | 'generalFolder'
    | 'eventTypesFolder'
    | 'readModelTypesFolder'
    | 'projectionsFolder'
    | 'generalSeedDataFolder'
    // System container
    | 'systemFolder'
    | 'usersFolder'
    | 'applicationsFolder'
    // Leaf items
    | 'recommendation'
    | 'job'
    | 'observer'
    | 'failedPartition'
    | 'identity'
    | 'eventType'
    | 'readModelType'
    | 'projection'
    | 'eventSequence'
    // Utility
    | 'empty'
    | 'unavailable'
    | 'error'
    | 'noConnection';

// ── Tree item ────────────────────────────────────────────────────────────────

export interface ChronicleTreeItemDetails {
    title: string;
    data: Record<string, unknown>;
}

export class ChronicleTreeItem extends vscode.TreeItem {
    readonly itemType: ItemType;
    readonly eventStoreName?: string;
    readonly namespaceName?: string;
    readonly details?: ChronicleTreeItemDetails;

    constructor(
        label: string,
        itemType: ItemType,
        collapsibleState: vscode.TreeItemCollapsibleState,
        opts?: {
            eventStoreName?: string;
            namespaceName?: string;
            description?: string;
            tooltip?: string;
            details?: ChronicleTreeItemDetails;
        }
    ) {
        super(label, collapsibleState);
        this.itemType = itemType;
        this.eventStoreName = opts?.eventStoreName;
        this.namespaceName = opts?.namespaceName;
        this.details = opts?.details;
        // contextValue powers the `viewItem ==` clauses in package.json menus.
        // The root context items override this with `context` / `contextActive` for their own actions.
        this.contextValue = itemType;
        if (opts?.description) { this.description = opts.description; }
        if (opts?.tooltip) { this.tooltip = opts.tooltip; }

        switch (itemType) {
            case 'context':         this.iconPath = new vscode.ThemeIcon('account'); break;
            case 'eventStore':      this.iconPath = new vscode.ThemeIcon('database'); break;
            case 'namespace':       this.iconPath = new vscode.ThemeIcon('folder'); break;

            // Namespace-scoped folders
            case 'recommendationsFolder': this.iconPath = new vscode.ThemeIcon('info'); break;
            case 'jobsFolder':            this.iconPath = new vscode.ThemeIcon('gear'); break;
            case 'sequencesFolder':       this.iconPath = new vscode.ThemeIcon('list-ordered'); break;
            case 'observersFolder':       this.iconPath = new vscode.ThemeIcon('eye'); break;
            case 'failedPartitionsFolder': this.iconPath = new vscode.ThemeIcon('error'); break;
            case 'readModelsFolder':      this.iconPath = new vscode.ThemeIcon('table'); break;
            case 'identitiesFolder':      this.iconPath = new vscode.ThemeIcon('person'); break;
            case 'seedDataFolder':        this.iconPath = new vscode.ThemeIcon('beaker'); break;

            // General / system containers
            case 'generalFolder':         this.iconPath = new vscode.ThemeIcon('settings-gear'); break;
            case 'eventTypesFolder':      this.iconPath = new vscode.ThemeIcon('symbol-class'); break;
            case 'readModelTypesFolder':  this.iconPath = new vscode.ThemeIcon('symbol-interface'); break;
            case 'projectionsFolder':     this.iconPath = new vscode.ThemeIcon('type-hierarchy'); break;
            case 'generalSeedDataFolder': this.iconPath = new vscode.ThemeIcon('beaker'); break;
            case 'systemFolder':          this.iconPath = new vscode.ThemeIcon('shield'); break;
            case 'usersFolder':           this.iconPath = new vscode.ThemeIcon('person'); break;
            case 'applicationsFolder':    this.iconPath = new vscode.ThemeIcon('lock'); break;

            // Leaf items
            case 'recommendation':  this.iconPath = new vscode.ThemeIcon('lightbulb'); break;
            case 'job':             this.iconPath = new vscode.ThemeIcon('run-all'); break;
            case 'observer':        this.iconPath = new vscode.ThemeIcon('pulse'); break;
            case 'failedPartition': this.iconPath = new vscode.ThemeIcon('warning'); break;
            case 'identity':        this.iconPath = new vscode.ThemeIcon('account'); break;
            case 'eventType':       this.iconPath = new vscode.ThemeIcon('symbol-event'); break;
            case 'readModelType':   this.iconPath = new vscode.ThemeIcon('symbol-struct'); break;
            case 'projection':      this.iconPath = new vscode.ThemeIcon('symbol-method'); break;
            case 'eventSequence':   this.iconPath = new vscode.ThemeIcon('list-ordered'); break;

            case 'noConnection':
                this.iconPath = new vscode.ThemeIcon('plug');
                this.command = { command: 'narrator.connect', title: 'Connect to Chronicle' };
                break;
            case 'unavailable':
                this.iconPath = new vscode.ThemeIcon('circle-slash');
                break;
            case 'empty':           this.iconPath = new vscode.ThemeIcon('info'); break;
            case 'error':           this.iconPath = new vscode.ThemeIcon('error'); break;
        }
    }
}

// ── Helper factory functions ─────────────────────────────────────────────────

function folder(label: string, type: ItemType, eventStore: string, namespace?: string): ChronicleTreeItem {
    return new ChronicleTreeItem(label, type, vscode.TreeItemCollapsibleState.Collapsed, {
        eventStoreName: eventStore, namespaceName: namespace
    });
}

function leaf(
    label: string,
    type: ItemType,
    opts?: {
        eventStoreName?: string;
        namespaceName?: string;
        description?: string;
        tooltip?: string;
        details?: ChronicleTreeItemDetails;
    },
): ChronicleTreeItem {
    return new ChronicleTreeItem(label, type, vscode.TreeItemCollapsibleState.None, opts);
}

function emptyItem(): ChronicleTreeItem {
    return leaf('No items found', 'empty');
}

function unavailableItem(msg = 'Not available via gRPC API'): ChronicleTreeItem {
    return leaf(msg, 'unavailable');
}

function errorItem(err: unknown): ChronicleTreeItem {
    return leaf(`Error: ${err instanceof Error ? err.message : String(err)}`, 'error');
}

async function loadItems<T>(
    fn: () => Promise<T[]>,
    map: (item: T) => ChronicleTreeItem
): Promise<ChronicleTreeItem[]> {
    try {
        const items = await fn();
        return items.length === 0 ? [emptyItem()] : items.map(map);
    } catch (err) {
        return [errorItem(err)];
    }
}

// ── Provider ─────────────────────────────────────────────────────────────────

export class ChronicleTreeDataProvider implements vscode.TreeDataProvider<ChronicleTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<ChronicleTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private _clientManager: ChronicleClientManager | undefined;
    private _activeContextName: string | undefined;
    private _config: Configuration;

    constructor(
        clientManager: ChronicleClientManager | undefined,
        activeContextName: string | undefined,
        config: Configuration
    ) {
        this._clientManager = clientManager;
        this._activeContextName = activeContextName;
        this._config = config;
    }

    setClientManager(
        manager: ChronicleClientManager | undefined,
        activeContextName?: string,
        config?: Configuration
    ): void {
        this._clientManager = manager;
        this._activeContextName = activeContextName;
        if (config) { this._config = config; }
        this.refresh();
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ChronicleTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: ChronicleTreeItem): Promise<ChronicleTreeItem[]> {
        if (!element) { return this._getRootChildren(); }

        const mgr = this._clientManager;
        const es = element.eventStoreName!;
        const ns = element.namespaceName!;

        switch (element.itemType) {
            // ── Level 0 → event stores ─────────────────────────────────────
            case 'context':
                return this._getEventStores();

            // ── Level 1 → namespace list + General + System ────────────────
            case 'eventStore':
                return this._getEventStoreChildren(es);

            // ── Level 2 (namespace) → category folders ─────────────────────
            case 'namespace':
                return [
                    folder('Recommendations', 'recommendationsFolder', es, ns),
                    folder('Jobs',            'jobsFolder',            es, ns),
                    folder('Sequences',       'sequencesFolder',       es, ns),
                    folder('Observers',       'observersFolder',       es, ns),
                    folder('Failed Partitions','failedPartitionsFolder',es, ns),
                    folder('Read Models',     'readModelsFolder',      es, ns),
                    folder('Identities',      'identitiesFolder',      es, ns),
                    leaf('Seed Data',         'seedDataFolder', { eventStoreName: es, namespaceName: ns }),
                ];

            // ── Namespace-scoped items ─────────────────────────────────────
            case 'recommendationsFolder':
                return loadItems(
                    () => mgr!.listRecommendations(es, ns),
                    (r) => leaf(r.name, 'recommendation', {
                        description: r.type,
                        tooltip: `ID: ${r.id}`,
                        details: { title: `Recommendation: ${r.name}`, data: { ...r } },
                    })
                );

            case 'jobsFolder':
                return loadItems(
                    () => mgr!.listJobs(es, ns),
                    (j) => leaf(j.type || j.id, 'job', {
                        description: `Status: ${j.status}`,
                        tooltip: `ID: ${j.id}`,
                        details: { title: `Job: ${j.type || j.id}`, data: { ...j } },
                    })
                );

            case 'sequencesFolder':
                if (!mgr) { return []; }
                return mgr.listEventSequences().map((sequence) => {
                    const item = leaf(sequence.name, 'eventSequence', {
                        eventStoreName: es,
                        namespaceName: ns,
                        description: sequence.description,
                        tooltip: `ID: ${sequence.id}`,
                        details: {
                            title: `Event Sequence: ${sequence.name}`,
                            data: { id: sequence.id, name: sequence.name, description: sequence.description },
                        },
                    });
                    item.command = {
                        command: 'narrator.openEventSequence',
                        title: 'Browse Events',
                        arguments: [item],
                    };
                    return item;
                });

            case 'observersFolder':
                return loadItems(
                    () => mgr!.listObservers(es, ns),
                    (o) => leaf(o.id, 'observer', {
                        description: `${o.type} · ${o.runningState}`,
                        details: { title: `Observer: ${o.id}`, data: { ...o } },
                    })
                );

            case 'failedPartitionsFolder':
                return loadItems(
                    () => mgr!.listFailedPartitions(es, ns),
                    (fp) => leaf(fp.partition, 'failedPartition', {
                        description: `Observer: ${fp.observerId}`,
                        tooltip: `ID: ${fp.id}`,
                        details: { title: `Failed Partition: ${fp.partition}`, data: { ...fp } },
                    })
                );

            case 'readModelsFolder':
                return [unavailableItem('Read model instances require a model type selection')];

            case 'identitiesFolder':
                return loadItems(
                    () => mgr!.listIdentities(es, ns),
                    (i) => {
                        const label = i.name || i.userName || i.subject;
                        const desc = i.name && i.userName && i.name !== i.userName ? i.userName : undefined;
                        return leaf(label, 'identity', {
                            description: desc,
                            tooltip: `Subject: ${i.subject}`,
                            details: { title: `Identity: ${label}`, data: { ...i } },
                        });
                    }
                );

            case 'seedDataFolder':
                return [unavailableItem('Seed data management not available in Explorer')];

            // ── General (event-store level) ────────────────────────────────
            case 'generalFolder':
                return [
                    folder('Event Types',      'eventTypesFolder',      es),
                    folder('Read Model Types', 'readModelTypesFolder',  es),
                    folder('Projections',      'projectionsFolder',     es),
                    leaf('Webhooks',           'unavailable', { eventStoreName: es, tooltip: 'Webhooks are not available in the Explorer' }),
                    leaf('Seed Data',          'generalSeedDataFolder', { eventStoreName: es }),
                ];

            case 'eventTypesFolder':
                return loadItems(
                    () => mgr!.listEventTypes(es),
                    (et) => leaf(et.id, 'eventType', {
                        description: `v${et.generation}`,
                        details: { title: `Event Type: ${et.id}`, data: { ...et } },
                    })
                );

            case 'readModelTypesFolder':
                return loadItems(
                    () => mgr!.listReadModelTypes(es),
                    (rm) => leaf(rm.displayName, 'readModelType', {
                        description: rm.identifier !== rm.displayName ? rm.identifier : undefined,
                        details: { title: `Read Model: ${rm.displayName}`, data: { ...rm } },
                    })
                );

            case 'projectionsFolder':
                return loadItems(
                    () => mgr!.listProjections(es),
                    (p) => leaf(p.identifier, 'projection', {
                        description: p.readModel,
                        details: { title: `Projection: ${p.identifier}`, data: { ...p } },
                    })
                );

            case 'generalSeedDataFolder':
                return [unavailableItem('Seed data management not available in Explorer')];

            // ── System ────────────────────────────────────────────────────
            case 'systemFolder':
                return [
                    folder('Users',        'usersFolder',        es),
                    folder('Applications', 'applicationsFolder', es),
                ];

            case 'usersFolder':
            case 'applicationsFolder':
                return [unavailableItem('Not available in the Explorer')];

            default:
                return [];
        }
    }

    private _getRootChildren(): ChronicleTreeItem[] {
        const contextNames = Object.keys(this._config.contexts);
        if (contextNames.length === 0) {
            const item = new ChronicleTreeItem(
                'No contexts — click \u002B to add one',
                'noConnection',
                vscode.TreeItemCollapsibleState.None
            );
            item.command = { command: 'narrator.addContext', title: 'Add Context' };
            return [item];
        }

        return contextNames.map(name => {
            const ctx = this._config.contexts[name];
            const isActive = name === this._activeContextName;
            const isConnected = isActive && (this._clientManager?.isConnected ?? false);

            let description: string;
            if (isActive && isConnected) {
                description = 'connected';
            } else if (isActive) {
                description = 'not connected';
            } else {
                description = ctx.server ?? '';
            }

            const item = new ChronicleTreeItem(
                name,
                'context',
                isActive && isConnected
                    ? vscode.TreeItemCollapsibleState.Collapsed
                    : vscode.TreeItemCollapsibleState.None,
                {
                    description,
                    tooltip: ctx.server,
                    details: {
                        title: `Context: ${name}`,
                        data: {
                            name,
                            active: isActive,
                            connected: isConnected,
                            server: ctx.server,
                            eventStore: ctx.eventStore,
                            namespace: ctx.namespace,
                            clientId: ctx.clientId,
                            loggedInUser: ctx.loggedInUser,
                        },
                    },
                }
            );
            item.contextValue = isActive ? 'contextActive' : 'context';
            if (!isActive) {
                item.command = { command: 'narrator.activateContext', title: 'Set as Active', arguments: [item] };
            }
            return item;
        });
    }

    private async _getEventStores(): Promise<ChronicleTreeItem[]> {
        const mgr = this._clientManager;
        if (!mgr) { return []; }
        return loadItems(
            () => mgr.listEventStores(),
            (name) => new ChronicleTreeItem(name, 'eventStore', vscode.TreeItemCollapsibleState.Collapsed, {
                eventStoreName: name,
            })
        );
    }

    /** Returns namespaces + General + System for an event store */
    private async _getEventStoreChildren(eventStore: string): Promise<ChronicleTreeItem[]> {
        const mgr = this._clientManager;
        if (!mgr) { return []; }

        // Fetch namespaces to list them individually
        let namespaceItems: ChronicleTreeItem[];
        try {
            const namespaces = await mgr.listNamespaces(eventStore);
            namespaceItems = namespaces.length === 0
                ? [emptyItem()]
                : namespaces.map((ns) =>
                    new ChronicleTreeItem(ns, 'namespace', vscode.TreeItemCollapsibleState.Collapsed, {
                        eventStoreName: eventStore, namespaceName: ns,
                    })
                );
        } catch (err) {
            namespaceItems = [errorItem(err)];
        }

        return [
            ...namespaceItems,
            folder('General', 'generalFolder', eventStore),
            folder('System',  'systemFolder',  eventStore),
        ];
    }
}
