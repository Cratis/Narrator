// Copyright (c) Cratis. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

import { describe, expect, it, vi } from 'vitest';
import { ChronicleTreeItem } from '../../providers/ChronicleTreeDataProvider';

vi.mock('vscode', async () => (await import('../../for_Shared/fake_vscode')).createTreeVscodeModule());

const expectedIcons: Record<string, string> = {
    context: 'account', eventStore: 'database', namespace: 'folder',
    recommendationsFolder: 'info', jobsFolder: 'gear', sequencesFolder: 'list-ordered', observersFolder: 'eye',
    failedPartitionsFolder: 'error', readModelsFolder: 'table', identitiesFolder: 'person', seedDataFolder: 'beaker',
    generalFolder: 'settings-gear', eventTypesFolder: 'symbol-class', readModelTypesFolder: 'symbol-interface',
    projectionsFolder: 'type-hierarchy', generalSeedDataFolder: 'beaker', systemFolder: 'shield',
    usersFolder: 'person', applicationsFolder: 'lock',
    recommendation: 'lightbulb', job: 'run-all', observer: 'pulse', failedPartition: 'warning', identity: 'account',
    eventType: 'symbol-event', readModelType: 'symbol-struct', projection: 'symbol-method', eventSequence: 'list-ordered',
    noConnection: 'plug', unavailable: 'circle-slash', empty: 'info', error: 'error',
};

const create = (itemType: string, options?: object) =>
    new ChronicleTreeItem('label', itemType as never, 1, options) as unknown as Record<string, unknown>;

describe('when creating items of each type', () => {
    for (const [itemType, icon] of Object.entries(expectedIcons)) {
        it(`should use the ${icon} icon for ${itemType}`, () => {
            expect((create(itemType).iconPath as { id: string }).id).toBe(icon);
        });

        it(`should use ${itemType} as the context value`, () => {
            expect(create(itemType).contextValue).toBe(itemType);
        });
    }

    it('should open the connect command for a no connection item', () => {
        expect(create('noConnection').command).toEqual({ command: 'narrator.connect', title: 'Connect to Chronicle' });
    });

    it('should not set a command for other item types', () => {
        expect(create('eventStore').command).toBeUndefined();
    });
});

describe('when creating an item with options', () => {
    const details = { title: 'T', data: { a: 1 } };
    const item = create('eventStore', {
        eventStoreName: 'es', namespaceName: 'ns', description: 'desc', tooltip: 'tip', details,
    });

    it('should keep the names, details, description and tooltip', () => {
        expect(item).toMatchObject({
            itemType: 'eventStore', eventStoreName: 'es', namespaceName: 'ns', details,
            description: 'desc', tooltip: 'tip', collapsibleState: 1, label: 'label',
        });
    });
});

describe('when creating an item with empty description and tooltip', () => {
    const item = create('eventStore', { description: '', tooltip: '' });

    it('should leave description and tooltip unset', () => {
        expect(item.description).toBeUndefined();
        expect(item.tooltip).toBeUndefined();
    });
});
