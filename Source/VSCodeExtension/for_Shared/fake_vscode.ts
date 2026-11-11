// Copyright (c) Cratis. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

export class FakeTreeItem {
    description?: string | boolean;
    tooltip?: unknown;
    iconPath?: unknown;
    command?: unknown;
    contextValue?: string;

    constructor(public label: unknown, public collapsibleState?: number) {}
}

export class FakeThemeIcon {
    constructor(public id: string) {}
}

export class FakeEventEmitter<T> {
    readonly fired: T[] = [];
    event = (): void => {};

    fire(value?: T): void { this.fired.push(value as T); }
}

export const FakeCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };

/** Module shape returned from `vi.mock('vscode', ...)` for tree-view specs. */
export function createTreeVscodeModule(): Record<string, unknown> {
    return {
        TreeItem: FakeTreeItem,
        ThemeIcon: FakeThemeIcon,
        TreeItemCollapsibleState: FakeCollapsibleState,
        EventEmitter: FakeEventEmitter,
    };
}
