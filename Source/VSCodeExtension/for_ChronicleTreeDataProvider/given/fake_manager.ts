// Copyright (c) Cratis. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

import { ChronicleClientManager } from '../../ChronicleClientManager';

export interface Described {
    label: string;
    type: string;
    description?: unknown;
    tooltip?: unknown;
    state?: number;
    eventStore?: string;
    namespace?: string;
    command?: unknown;
    details?: unknown;
}

/** Projects a tree item onto the properties the specs assert on. */
export function describe(items: { label?: unknown }[]): Described[] {
    return items.map(item => {
        const treeItem = item as unknown as Record<string, unknown>;
        return {
            label: treeItem.label as string,
            type: treeItem.itemType as string,
            description: treeItem.description,
            tooltip: treeItem.tooltip,
            state: treeItem.collapsibleState as number,
            eventStore: treeItem.eventStoreName as string | undefined,
            namespace: treeItem.namespaceName as string | undefined,
            command: treeItem.command,
            details: treeItem.details,
        };
    });
}

export function createManager(overrides: Record<string, unknown> = {}): ChronicleClientManager {
    return {
        isConnected: true,
        listEventStores: async () => ['store-a'],
        listNamespaces: async () => ['ns-a'],
        listRecommendations: async () => [{ id: 'r1', name: 'Rec', type: 'Cleanup' }],
        listJobs: async () => [{ id: 'j1', type: 'Replay', status: 'Running', statusCode: 4 }],
        listEventSequences: () => [{ id: 'event-log', name: 'Event Log', description: 'Default event log' }],
        listObservers: async () => [{ id: 'o1', type: 'Reactor', runningState: 'Active' }],
        listFailedPartitions: async () => [{ id: '(unknown)', observerId: 'o1', partition: 'p1', attempts: [] }],
        listIdentities: async () => [
            { subject: 's1', name: 'Ann', userName: 'ann@x' },
            { subject: 's2', name: 'Bob', userName: 'Bob' },
            { subject: 's3', name: '', userName: 'carl' },
            { subject: 's4', name: '', userName: '' },
        ],
        listEventTypes: async () => [{ id: 'et1', generation: 2 }],
        listReadModelTypes: async () => [
            { identifier: 'id-1', displayName: 'Display' },
            { identifier: 'same', displayName: 'same' },
        ],
        listProjections: async () => [{ identifier: 'pr1', readModel: 'rm1' }],
        ...overrides,
    } as unknown as ChronicleClientManager;
}
