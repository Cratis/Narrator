// Copyright (c) Cratis. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DetailsTreeDataProvider } from '../../providers/DetailsTreeDataProvider';

vi.mock('vscode', async () => (await import('../../for_Shared/fake_vscode')).createTreeVscodeModule());

interface Row {
    label: string;
    description?: unknown;
    tooltip?: unknown;
    icon?: string;
    expanded: boolean;
    children?: Row[];
}

function rowsOf(provider: DetailsTreeDataProvider, parent?: unknown): Row[] {
    const items = provider.getChildren(parent as never) as unknown as {
        label: string; description?: unknown; tooltip?: unknown; iconPath?: { id: string }; collapsibleState: number;
    }[];
    return items.map(item => ({
        label: item.label,
        description: item.description,
        tooltip: item.tooltip,
        icon: item.iconPath?.id,
        expanded: item.collapsibleState === 2,
        children: item.collapsibleState === 2 ? rowsOf(provider, item) : undefined,
    }));
}

describe('when nothing is shown', () => {
    const provider = new DetailsTreeDataProvider();

    it('should prompt for a selection at the root', () => {
        expect(rowsOf(provider)).toEqual([
            { label: 'Select an item to see details', description: undefined, tooltip: undefined, icon: 'info', expanded: false, children: undefined },
        ]);
    });

    it('should have no children below the prompt', () => {
        const [prompt] = provider.getChildren();
        expect(provider.getChildren(prompt)).toEqual([]);
        expect(provider.getTreeItem(prompt)).toBe(prompt);
    });
});

describe('when showing a section', () => {
    const provider = new DetailsTreeDataProvider();
    let rows: Row[];

    beforeEach(() => {
        provider.show({
            title: 'Title',
            data: {
                lastHandledEventSequenceNumber: 42,
                snake_case_name: 'text',
                'kebab-name': true,
                skipped: undefined,
                nothing: null,
                emptyList: [],
                one: [1],
                many: ['a', { b: 1 }],
                emptyObject: {},
                onlyUndefined: { x: undefined },
                nested: { innerKey: 'v', other: undefined, deeper: { z: false } },
                big: 10n,
                '': 'blank key',
            },
        });
        rows = rowsOf(provider);
    });

    const leaf = (label: string, description: unknown, tooltip?: unknown): Row =>
        ({ label, description, tooltip, icon: undefined, expanded: false, children: undefined });

    it('should show a header row with the title expanded', () => {
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ label: 'Title', icon: 'symbol-namespace', expanded: true });
    });

    it('should format keys and values of the top level rows', () => {
        const children = rows[0].children!;
        expect(children.map(child => [child.label, child.description, child.tooltip])).toEqual([
            ['Last Handled Event Sequence Number', '42', '42'],
            ['Snake case name', 'text', 'text'],
            ['Kebab name', 'true', 'true'],
            ['Nothing', 'null', undefined],
            ['Empty List', 'empty', undefined],
            ['One', '1 item', undefined],
            ['Many', '2 items', undefined],
            ['Empty Object', '(empty)', undefined],
            ['Only Undefined', '(empty)', undefined],
            ['Nested', undefined, undefined],
            ['Big', '10', undefined],
            ['', 'blank key', 'blank key'],
        ]);
    });

    it('should expand arrays into indexed rows', () => {
        const [, , , , , one, many] = rows[0].children!;
        expect(one.children).toEqual([leaf('[0]', '1', '1')]);
        expect(many.children![0]).toEqual(leaf('[0]', 'a', 'a'));
        expect(many.children![1]).toMatchObject({ label: '[1]', description: undefined, expanded: true });
        expect(many.children![1].children).toEqual([leaf('B', '1', '1')]);
    });

    it('should expand objects into key rows without undefined values', () => {
        const nested = rows[0].children![9];
        expect(nested.expanded).toBe(true);
        expect(nested.children!.map(child => child.label)).toEqual(['Inner Key', 'Deeper']);
        expect(nested.children![1].children).toEqual([leaf('Z', 'false', 'false')]);
    });

    it('should not expand rows without children', () => {
        const [first] = rows[0].children!;
        expect(first.expanded).toBe(false);
    });
});

describe('when changing the shown section', () => {
    it('should fire a change event and go back to the prompt when cleared', () => {
        const provider = new DetailsTreeDataProvider();
        provider.show({ title: 'T', data: {} });
        expect(rowsOf(provider)[0].label).toBe('T');
        expect(rowsOf(provider)[0].expanded).toBe(false);
        provider.clear();
        expect(rowsOf(provider)[0].label).toBe('Select an item to see details');
    });
});
