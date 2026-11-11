// Copyright (c) Cratis. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChronicleTreeDataProvider, ChronicleTreeItem } from '../../providers/ChronicleTreeDataProvider';
import { createManager, describe as describeItems, Described } from '../given/fake_manager';

vi.mock('vscode', async () => (await import('../../for_Shared/fake_vscode')).createTreeVscodeModule());

const none = 0;
const collapsed = 1;

async function childrenOf(itemType: string, overrides: Record<string, unknown> = {}, noManager = false): Promise<Described[]> {
    const provider = new ChronicleTreeDataProvider(noManager ? undefined : createManager(overrides), 'dev', { contexts: {} });
    const element = new ChronicleTreeItem('x', itemType as never, collapsed, { eventStoreName: 'es', namespaceName: 'ns' });
    return describeItems(await provider.getChildren(element));
}

const folderOf = (label: string, type: string, namespace?: string): Partial<Described> =>
    ({ label, type, state: collapsed, eventStore: 'es', namespace });

describe('when getting children of a context', () => {
    let result: Described[];
    beforeEach(async () => { result = await childrenOf('context'); });

    it('should list the event stores', () => {
        expect(result).toMatchObject([{ label: 'store-a', type: 'eventStore', state: collapsed, eventStore: 'store-a' }]);
    });
});

describe('when getting children of a context without a manager', () => {
    it('should return nothing', async () => {
        expect(await childrenOf('context', {}, true)).toEqual([]);
    });
});

describe('when getting children of an event store', () => {
    it('should list namespaces followed by general and system folders', async () => {
        expect(await childrenOf('eventStore')).toMatchObject([
            { label: 'ns-a', type: 'namespace', state: collapsed, eventStore: 'es', namespace: 'ns-a' },
            folderOf('General', 'generalFolder'),
            folderOf('System', 'systemFolder'),
        ]);
    });

    it('should show an empty item when there are no namespaces', async () => {
        const result = await childrenOf('eventStore', { listNamespaces: async () => [] });
        expect(result[0]).toMatchObject({ label: 'No items found', type: 'empty', state: none });
        expect(result).toHaveLength(3);
    });

    it('should show an error item when listing namespaces fails', async () => {
        const result = await childrenOf('eventStore', { listNamespaces: async () => { throw new Error('boom'); } });
        expect(result[0]).toMatchObject({ label: 'Error: boom', type: 'error' });
        expect(result).toHaveLength(3);
    });

    it('should show a stringified error item for non-error failures', async () => {
        const result = await childrenOf('eventStore', { listNamespaces: async () => { throw 'plain'; } });
        expect(result[0]).toMatchObject({ label: 'Error: plain', type: 'error' });
    });

    it('should return nothing without a manager', async () => {
        expect(await childrenOf('eventStore', {}, true)).toEqual([]);
    });
});

describe('when getting children of a namespace', () => {
    it('should list the category folders', async () => {
        expect(await childrenOf('namespace')).toMatchObject([
            folderOf('Recommendations', 'recommendationsFolder', 'ns'),
            folderOf('Jobs', 'jobsFolder', 'ns'),
            folderOf('Sequences', 'sequencesFolder', 'ns'),
            folderOf('Observers', 'observersFolder', 'ns'),
            folderOf('Failed Partitions', 'failedPartitionsFolder', 'ns'),
            folderOf('Read Models', 'readModelsFolder', 'ns'),
            folderOf('Identities', 'identitiesFolder', 'ns'),
            { label: 'Seed Data', type: 'seedDataFolder', state: none, eventStore: 'es', namespace: 'ns' },
        ]);
    });
});

describe('when getting children of namespace folders', () => {
    it('should list recommendations', async () => {
        expect(await childrenOf('recommendationsFolder')).toEqual([{
            label: 'Rec', type: 'recommendation', description: 'Cleanup', tooltip: 'ID: r1', state: none,
            eventStore: undefined, namespace: undefined, command: undefined,
            details: { title: 'Recommendation: Rec', data: { id: 'r1', name: 'Rec', type: 'Cleanup' } },
        }]);
    });

    it('should list jobs by type', async () => {
        expect(await childrenOf('jobsFolder')).toMatchObject([{
            label: 'Replay', type: 'job', description: 'Status: Running', tooltip: 'ID: j1',
            details: { title: 'Job: Replay' },
        }]);
    });

    it('should list jobs by id when the type is empty', async () => {
        const result = await childrenOf('jobsFolder', { listJobs: async () => [{ id: 'j2', type: '', status: 'Failed' }] });
        expect(result).toMatchObject([{ label: 'j2', details: { title: 'Job: j2' } }]);
    });

    it('should list event sequences with an open command', async () => {
        const result = await childrenOf('sequencesFolder');
        expect(result).toMatchObject([{
            label: 'Event Log', type: 'eventSequence', description: 'Default event log', tooltip: 'ID: event-log',
            eventStore: 'es', namespace: 'ns',
            details: { title: 'Event Sequence: Event Log', data: { id: 'event-log', name: 'Event Log', description: 'Default event log' } },
            command: { command: 'narrator.openEventSequence', title: 'Browse Events' },
        }]);
        expect((result[0].command as { arguments: unknown[] }).arguments).toHaveLength(1);
    });

    it('should return nothing for sequences without a manager', async () => {
        expect(await childrenOf('sequencesFolder', {}, true)).toEqual([]);
    });

    it('should list observers', async () => {
        expect(await childrenOf('observersFolder')).toMatchObject([{
            label: 'o1', type: 'observer', description: 'Reactor · Active', details: { title: 'Observer: o1' },
        }]);
    });

    it('should list failed partitions', async () => {
        expect(await childrenOf('failedPartitionsFolder')).toMatchObject([{
            label: 'p1', type: 'failedPartition', description: 'Observer: o1', tooltip: 'ID: (unknown)',
            details: { title: 'Failed Partition: p1' },
        }]);
    });

    it('should list identities with the best label and a distinct user name description', async () => {
        const result = await childrenOf('identitiesFolder');
        expect(result.map(item => [item.label, item.description, item.tooltip])).toEqual([
            ['Ann', 'ann@x', 'Subject: s1'],
            ['Bob', undefined, 'Subject: s2'],
            ['carl', undefined, 'Subject: s3'],
            ['s4', undefined, 'Subject: s4'],
        ]);
        expect(result[0].details).toMatchObject({ title: 'Identity: Ann' });
    });

    it('should explain that read models need a type selection', async () => {
        expect(await childrenOf('readModelsFolder')).toMatchObject([
            { label: 'Read model instances require a model type selection', type: 'unavailable' },
        ]);
    });

    it('should explain that seed data is not available', async () => {
        expect(await childrenOf('seedDataFolder')).toMatchObject([
            { label: 'Seed data management not available in Explorer', type: 'unavailable' },
        ]);
    });

    it('should show an empty item when a list is empty', async () => {
        expect(await childrenOf('observersFolder', { listObservers: async () => [] })).toMatchObject([
            { label: 'No items found', type: 'empty' },
        ]);
    });

    it('should show an error item when loading fails', async () => {
        expect(await childrenOf('jobsFolder', { listJobs: async () => { throw new Error('nope'); } })).toMatchObject([
            { label: 'Error: nope', type: 'error' },
        ]);
    });

    it('should show an error item when there is no manager', async () => {
        const result = await childrenOf('jobsFolder', {}, true);
        expect(result).toMatchObject([{ type: 'error' }]);
        expect(result[0].label).toContain('Error: ');
    });
});

describe('when getting children of general folders', () => {
    it('should list the general sub folders', async () => {
        expect(await childrenOf('generalFolder')).toMatchObject([
            folderOf('Event Types', 'eventTypesFolder'),
            folderOf('Read Model Types', 'readModelTypesFolder'),
            folderOf('Projections', 'projectionsFolder'),
            { label: 'Webhooks', type: 'unavailable', state: none, eventStore: 'es', tooltip: 'Webhooks are not available in the Explorer' },
            { label: 'Seed Data', type: 'generalSeedDataFolder', state: none, eventStore: 'es' },
        ]);
    });

    it('should list event types', async () => {
        expect(await childrenOf('eventTypesFolder')).toMatchObject([{
            label: 'et1', type: 'eventType', description: 'v2', details: { title: 'Event Type: et1' },
        }]);
    });

    it('should list read model types with the identifier when it differs', async () => {
        const result = await childrenOf('readModelTypesFolder');
        expect(result.map(item => [item.label, item.description])).toEqual([['Display', 'id-1'], ['same', undefined]]);
        expect(result[0].details).toMatchObject({ title: 'Read Model: Display' });
    });

    it('should list projections', async () => {
        expect(await childrenOf('projectionsFolder')).toMatchObject([{
            label: 'pr1', type: 'projection', description: 'rm1', details: { title: 'Projection: pr1' },
        }]);
    });

    it('should explain that general seed data is not available', async () => {
        expect(await childrenOf('generalSeedDataFolder')).toMatchObject([
            { label: 'Seed data management not available in Explorer', type: 'unavailable' },
        ]);
    });
});

describe('when getting children of system folders', () => {
    it('should list users and applications', async () => {
        expect(await childrenOf('systemFolder')).toMatchObject([
            folderOf('Users', 'usersFolder'),
            folderOf('Applications', 'applicationsFolder'),
        ]);
    });

    it('should explain that users are not available', async () => {
        expect(await childrenOf('usersFolder')).toMatchObject([{ label: 'Not available in the Explorer', type: 'unavailable' }]);
    });

    it('should explain that applications are not available', async () => {
        expect(await childrenOf('applicationsFolder')).toMatchObject([{ label: 'Not available in the Explorer', type: 'unavailable' }]);
    });

    it('should return nothing for leaf items', async () => {
        expect(await childrenOf('observer')).toEqual([]);
    });
});
