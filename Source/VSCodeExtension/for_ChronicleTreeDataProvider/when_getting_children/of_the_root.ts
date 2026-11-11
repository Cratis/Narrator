// Copyright (c) Cratis. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

import { describe, expect, it, vi } from 'vitest';
import { ChronicleTreeDataProvider } from '../../providers/ChronicleTreeDataProvider';
import { createManager, describe as describeItems } from '../given/fake_manager';
import { Configuration } from '../../Configuration';

vi.mock('vscode', async () => (await import('../../for_Shared/fake_vscode')).createTreeVscodeModule());

const config: Configuration = {
    contexts: {
        dev: { server: 'chronicle://dev', eventStore: 'e', namespace: 'n', clientId: 'c', loggedInUser: 'u' },
        prod: { server: 'chronicle://prod' },
        bare: {},
    },
};

const rootOf = async (active: string | undefined, connected: boolean) => {
    const manager = createManager({ isConnected: connected });
    const provider = new ChronicleTreeDataProvider(manager, active, config);
    return provider.getChildren();
};

describe('when getting root children without contexts', () => {
    it('should offer to add a context', async () => {
        const provider = new ChronicleTreeDataProvider(undefined, undefined, { contexts: {} });
        expect(describeItems(await provider.getChildren())).toMatchObject([{
            label: 'No contexts — click + to add one',
            type: 'noConnection',
            state: 0,
            command: { command: 'narrator.addContext', title: 'Add Context' },
        }]);
    });
});

describe('when getting root children with an active connected context', () => {
    it('should describe contexts and make only the active one expandable', async () => {
        const items = await rootOf('dev', true);
        expect(describeItems(items).map(item => [item.label, item.description, item.state, item.tooltip])).toEqual([
            ['dev', 'connected', 1, 'chronicle://dev'],
            ['prod', 'chronicle://prod', 0, 'chronicle://prod'],
            ['bare', undefined, 0, undefined],
        ]);
    });

    it('should set context values and activation commands', async () => {
        const items = describeItems(await rootOf('dev', true));
        const raw = (await rootOf('dev', true)) as unknown as { contextValue: string }[];
        expect(raw.map(item => item.contextValue)).toEqual(['contextActive', 'context', 'context']);
        expect(items[0].command).toBeUndefined();
        expect((items[1].command as { command: string; title: string }).command).toBe('narrator.activateContext');
        expect((items[1].command as { title: string }).title).toBe('Set as Active');
        expect((items[1].command as { arguments: unknown[] }).arguments).toHaveLength(1);
    });

    it('should carry the context details', async () => {
        const items = describeItems(await rootOf('dev', true));
        expect(items[0].details).toEqual({
            title: 'Context: dev',
            data: {
                name: 'dev', active: true, connected: true, server: 'chronicle://dev', eventStore: 'e', namespace: 'n',
                clientId: 'c', loggedInUser: 'u',
            },
        });
    });
});

describe('when getting root children with an active context that is not connected', () => {
    it('should say not connected and not be expandable', async () => {
        const items = describeItems(await rootOf('dev', false));
        expect([items[0].description, items[0].state]).toEqual(['not connected', 0]);
        expect((items[0].details as { data: { connected: boolean } }).data.connected).toBe(false);
    });
});

describe('when getting root children without a client manager', () => {
    it('should treat the active context as not connected', async () => {
        const provider = new ChronicleTreeDataProvider(undefined, 'dev', config);
        const items = describeItems(await provider.getChildren());
        expect(items[0].description).toBe('not connected');
    });
});

describe('when changing the client manager', () => {
    it('should refresh and use the new configuration', async () => {
        const provider = new ChronicleTreeDataProvider(undefined, undefined, { contexts: {} });
        provider.setClientManager(createManager(), 'prod', config);
        const items = describeItems(await provider.getChildren());
        expect(items.map(item => item.label)).toEqual(['dev', 'prod', 'bare']);
        expect(provider.getTreeItem(await provider.getChildren().then(children => children[0]))).toBeDefined();
    });

    it('should keep the configuration when none is given', async () => {
        const provider = new ChronicleTreeDataProvider(undefined, undefined, config);
        provider.setClientManager(undefined);
        expect(await provider.getChildren()).toHaveLength(3);
    });
});
