// Copyright (c) Cratis. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

import * as vscode from 'vscode';
import {
    ChronicleClientManager,
    EventTypeInfo,
    FailedPartitionInfo,
    IdentityInfo,
    JobInfo,
    ObserverInfo,
    ProjectionInfo,
    ReadModelTypeInfo,
    RecommendationInfo,
} from '../ChronicleClientManager';
import { Configuration, Context } from '../Configuration';

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

interface ChronicleTreeItemOptions {
    eventStoreName?: string;
    namespaceName?: string;
    description?: string;
    tooltip?: string;
    details?: ChronicleTreeItemDetails;
}

const ITEM_ICONS: Record<ItemType, string> = {
    context: 'account',
    eventStore: 'database',
    namespace: 'folder',

    // Namespace-scoped folders
    recommendationsFolder: 'info',
    jobsFolder: 'gear',
    sequencesFolder: 'list-ordered',
    observersFolder: 'eye',
    failedPartitionsFolder: 'error',
    readModelsFolder: 'table',
    identitiesFolder: 'person',
    seedDataFolder: 'beaker',

    // General / system containers
    generalFolder: 'settings-gear',
    eventTypesFolder: 'symbol-class',
    readModelTypesFolder: 'symbol-interface',
    projectionsFolder: 'type-hierarchy',
    generalSeedDataFolder: 'beaker',
    systemFolder: 'shield',
    usersFolder: 'person',
    applicationsFolder: 'lock',

    // Leaf items
    recommendation: 'lightbulb',
    job: 'run-all',
    observer: 'pulse',
    failedPartition: 'warning',
    identity: 'account',
    eventType: 'symbol-event',
    readModelType: 'symbol-struct',
    projection: 'symbol-method',
    eventSequence: 'list-ordered',

    // Utility
    noConnection: 'plug',
    unavailable: 'circle-slash',
    empty: 'info',
    error: 'error',
};

export class ChronicleTreeItem extends vscode.TreeItem {
    readonly itemType: ItemType;
    readonly eventStoreName?: string;
    readonly namespaceName?: string;
    readonly details?: ChronicleTreeItemDetails;

    constructor(
        label: string,
        itemType: ItemType,
        collapsibleState: vscode.TreeItemCollapsibleState,
        opts?: ChronicleTreeItemOptions
    ) {
        super(label, collapsibleState);
        this.itemType = itemType;
        this.eventStoreName = opts?.eventStoreName;
        this.namespaceName = opts?.namespaceName;
        this.details = opts?.details;
        // contextValue powers the `viewItem ==` clauses in package.json menus.
        // The root context items override this with `context` / `contextActive` for their own actions.
        this.contextValue = itemType;
        this.applyText(opts);

        this.iconPath = new vscode.ThemeIcon(ITEM_ICONS[itemType]);
        if (itemType === 'noConnection') {
            this.command = { command: 'narrator.connect', title: 'Connect to Chronicle' };
        }
    }

    private applyText(opts?: ChronicleTreeItemOptions): void {
        if (opts?.description) { this.description = opts.description; }
        if (opts?.tooltip) { this.tooltip = opts.tooltip; }
    }
}

// ── Helper factory functions ─────────────────────────────────────────────────

function folder(label: string, type: ItemType, eventStore: string, namespace?: string): ChronicleTreeItem {
    return new ChronicleTreeItem(label, type, vscode.TreeItemCollapsibleState.Collapsed, {
        eventStoreName: eventStore, namespaceName: namespace
    });
}

function leaf(label: string, type: ItemType, opts?: ChronicleTreeItemOptions): ChronicleTreeItem {
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

// ── Children of folder items ─────────────────────────────────────────────────

/** What a folder item needs to produce its children. */
interface FolderScope {
    manager: ChronicleClientManager | undefined;
    eventStore: string;
    namespace: string;
}

type ChildrenLoader = (scope: FolderScope) => ChronicleTreeItem[] | Promise<ChronicleTreeItem[]>;

function unavailableChildren(message: string): ChildrenLoader {
    return () => [unavailableItem(message)];
}

function namespaceFolders({ eventStore, namespace }: FolderScope): ChronicleTreeItem[] {
    return [
        folder('Recommendations', 'recommendationsFolder', eventStore, namespace),
        folder('Jobs',            'jobsFolder',            eventStore, namespace),
        folder('Sequences',       'sequencesFolder',       eventStore, namespace),
        folder('Observers',       'observersFolder',       eventStore, namespace),
        folder('Failed Partitions','failedPartitionsFolder',eventStore, namespace),
        folder('Read Models',     'readModelsFolder',      eventStore, namespace),
        folder('Identities',      'identitiesFolder',      eventStore, namespace),
        leaf('Seed Data',         'seedDataFolder', { eventStoreName: eventStore, namespaceName: namespace }),
    ];
}

/** Builds a loader that lists items for a namespace-scoped folder and maps them to tree items. */
function namespaceLoader<T>(
    list: (manager: ChronicleClientManager, eventStore: string, namespace: string) => Promise<T[]>,
    map: (item: T) => ChronicleTreeItem
): ChildrenLoader {
    return ({ manager, eventStore, namespace }) => loadItems(() => list(manager!, eventStore, namespace), map);
}

/** Builds a loader that lists items for an event-store-scoped folder and maps them to tree items. */
function eventStoreLoader<T>(
    list: (manager: ChronicleClientManager, eventStore: string) => Promise<T[]>,
    map: (item: T) => ChronicleTreeItem
): ChildrenLoader {
    return ({ manager, eventStore }) => loadItems(() => list(manager!, eventStore), map);
}

function recommendationItem(r: RecommendationInfo): ChronicleTreeItem {
    return leaf(r.name, 'recommendation', {
        description: r.type,
        tooltip: `ID: ${r.id}`,
        details: { title: `Recommendation: ${r.name}`, data: { ...r } },
    });
}

function jobItem(j: JobInfo): ChronicleTreeItem {
    return leaf(j.type || j.id, 'job', {
        description: `Status: ${j.status}`,
        tooltip: `ID: ${j.id}`,
        details: { title: `Job: ${j.type || j.id}`, data: { ...j } },
    });
}

function eventSequences({ manager, eventStore, namespace }: FolderScope): ChronicleTreeItem[] {
    if (!manager) { return []; }
    return manager.listEventSequences().map((sequence) => {
        const item = leaf(sequence.name, 'eventSequence', {
            eventStoreName: eventStore,
            namespaceName: namespace,
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
}

function observerItem(o: ObserverInfo): ChronicleTreeItem {
    return leaf(o.id, 'observer', {
        description: `${o.type} · ${o.runningState}`,
        details: { title: `Observer: ${o.id}`, data: { ...o } },
    });
}

function failedPartitionItem(fp: FailedPartitionInfo): ChronicleTreeItem {
    return leaf(fp.partition, 'failedPartition', {
        description: `Observer: ${fp.observerId}`,
        tooltip: `ID: ${fp.id}`,
        details: { title: `Failed Partition: ${fp.partition}`, data: { ...fp } },
    });
}

function identityItem(i: IdentityInfo): ChronicleTreeItem {
    const label = i.name || i.userName || i.subject;
    const desc = i.name && i.userName && i.name !== i.userName ? i.userName : undefined;
    return leaf(label, 'identity', {
        description: desc,
        tooltip: `Subject: ${i.subject}`,
        details: { title: `Identity: ${label}`, data: { ...i } },
    });
}

function generalFolders({ eventStore }: FolderScope): ChronicleTreeItem[] {
    return [
        folder('Event Types',      'eventTypesFolder',      eventStore),
        folder('Read Model Types', 'readModelTypesFolder',  eventStore),
        folder('Projections',      'projectionsFolder',     eventStore),
        leaf('Webhooks',           'unavailable', { eventStoreName: eventStore, tooltip: 'Webhooks are not available in the Explorer' }),
        leaf('Seed Data',          'generalSeedDataFolder', { eventStoreName: eventStore }),
    ];
}

function eventTypeItem(et: EventTypeInfo): ChronicleTreeItem {
    return leaf(et.id, 'eventType', {
        description: `v${et.generation}`,
        details: { title: `Event Type: ${et.id}`, data: { ...et } },
    });
}

function readModelTypeItem(rm: ReadModelTypeInfo): ChronicleTreeItem {
    return leaf(rm.displayName, 'readModelType', {
        description: rm.identifier !== rm.displayName ? rm.identifier : undefined,
        details: { title: `Read Model: ${rm.displayName}`, data: { ...rm } },
    });
}

function projectionItem(p: ProjectionInfo): ChronicleTreeItem {
    return leaf(p.identifier, 'projection', {
        description: p.readModel,
        details: { title: `Projection: ${p.identifier}`, data: { ...p } },
    });
}

function systemFolders({ eventStore }: FolderScope): ChronicleTreeItem[] {
    return [
        folder('Users',        'usersFolder',        eventStore),
        folder('Applications', 'applicationsFolder', eventStore),
    ];
}

const SEED_DATA_NOT_AVAILABLE = 'Seed data management not available in Explorer';
const NOT_AVAILABLE_IN_EXPLORER = 'Not available in the Explorer';

/** Children for every item type that is resolved from its folder scope alone. */
const FOLDER_CHILDREN: Partial<Record<ItemType, ChildrenLoader>> = {
    // ── Level 2 (namespace) → category folders ─────────────────────────
    namespace: namespaceFolders,

    // ── Namespace-scoped items ─────────────────────────────────────────
    recommendationsFolder: namespaceLoader((m, es, ns) => m.listRecommendations(es, ns), recommendationItem),
    jobsFolder: namespaceLoader((m, es, ns) => m.listJobs(es, ns), jobItem),
    sequencesFolder: eventSequences,
    observersFolder: namespaceLoader((m, es, ns) => m.listObservers(es, ns), observerItem),
    failedPartitionsFolder: namespaceLoader((m, es, ns) => m.listFailedPartitions(es, ns), failedPartitionItem),
    readModelsFolder: unavailableChildren('Read model instances require a model type selection'),
    identitiesFolder: namespaceLoader((m, es, ns) => m.listIdentities(es, ns), identityItem),
    seedDataFolder: unavailableChildren(SEED_DATA_NOT_AVAILABLE),

    // ── General (event-store level) ────────────────────────────────────
    generalFolder: generalFolders,
    eventTypesFolder: eventStoreLoader((m, es) => m.listEventTypes(es), eventTypeItem),
    readModelTypesFolder: eventStoreLoader((m, es) => m.listReadModelTypes(es), readModelTypeItem),
    projectionsFolder: eventStoreLoader((m, es) => m.listProjections(es), projectionItem),
    generalSeedDataFolder: unavailableChildren(SEED_DATA_NOT_AVAILABLE),

    // ── System ────────────────────────────────────────────────────────
    systemFolder: systemFolders,
    usersFolder: unavailableChildren(NOT_AVAILABLE_IN_EXPLORER),
    applicationsFolder: unavailableChildren(NOT_AVAILABLE_IN_EXPLORER),
};

// ── Root (context) items ─────────────────────────────────────────────────────

function describeContext(context: Context, isActive: boolean, isConnected: boolean): string {
    if (!isActive) { return context.server ?? ''; }
    return isConnected ? 'connected' : 'not connected';
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

        const es = element.eventStoreName!;

        switch (element.itemType) {
            // ── Level 0 → event stores ─────────────────────────────────────
            case 'context':
                return this._getEventStores();

            // ── Level 1 → namespace list + General + System ────────────────
            case 'eventStore':
                return this._getEventStoreChildren(es);

            default: {
                const loadChildren = FOLDER_CHILDREN[element.itemType];
                return loadChildren
                    ? loadChildren({ manager: this._clientManager, eventStore: es, namespace: element.namespaceName! })
                    : [];
            }
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

        return contextNames.map(name => this._createContextItem(name));
    }

    private _createContextItem(name: string): ChronicleTreeItem {
        const ctx = this._config.contexts[name];
        const isActive = name === this._activeContextName;
        const isConnected = isActive && (this._clientManager?.isConnected ?? false);

        const item = new ChronicleTreeItem(
            name,
            'context',
            isActive && isConnected
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None,
            {
                description: describeContext(ctx, isActive, isConnected),
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
