// Copyright (c) Cratis. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

import * as vscode from 'vscode';

export interface DetailsSection {
    title: string;
    data: Record<string, unknown>;
}

interface DetailsNode {
    label: string;
    value?: string;
    tooltip?: string;
    children?: DetailsNode[];
    iconId?: string;
}

class DetailsItem extends vscode.TreeItem {
    constructor(public readonly node: DetailsNode) {
        super(
            node.label,
            node.children && node.children.length > 0
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.None,
        );
        if (node.value !== undefined) {
            this.description = node.value;
        }
        if (node.tooltip) {
            this.tooltip = node.tooltip;
        }
        if (node.iconId) {
            this.iconPath = new vscode.ThemeIcon(node.iconId);
        }
    }
}

/**
 * Renders structured key/value details for the item currently selected in the Chronicle Explorer.
 * Top-level keys appear as rows with their formatted value as the description; nested objects and
 * arrays expand into child rows.
 */
export class DetailsTreeDataProvider implements vscode.TreeDataProvider<DetailsItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<DetailsItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private _section: DetailsSection | undefined;

    show(section: DetailsSection | undefined): void {
        this._section = section;
        this._onDidChangeTreeData.fire();
    }

    clear(): void {
        this.show(undefined);
    }

    getTreeItem(element: DetailsItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: DetailsItem): DetailsItem[] {
        if (!this._section) {
            const empty = new DetailsItem({
                label: 'Select an item to see details',
                iconId: 'info',
            });
            return element ? [] : [empty];
        }

        if (!element) {
            const header = new DetailsItem({
                label: this._section.title,
                iconId: 'symbol-namespace',
                children: buildNodes(this._section.data),
            });
            return [header];
        }

        return (element.node.children ?? []).map((child) => new DetailsItem(child));
    }
}

function buildNodes(data: Record<string, unknown>): DetailsNode[] {
    return Object.entries(data)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => toNode(formatKey(key), value));
}

function toNode(label: string, value: unknown): DetailsNode {
    if (value === null || value === undefined) {
        return { label, value: 'null' };
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        const text = String(value);
        return { label, value: text, tooltip: text };
    }
    if (Array.isArray(value)) {
        if (value.length === 0) {
            return { label, value: 'empty' };
        }
        return {
            label,
            value: `${value.length} item${value.length === 1 ? '' : 's'}`,
            children: value.map((entry, index) => toNode(`[${index}]`, entry)),
        };
    }
    if (typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
        if (entries.length === 0) {
            return { label, value: '(empty)' };
        }
        return {
            label,
            children: entries.map(([k, v]) => toNode(formatKey(k), v)),
        };
    }
    return { label, value: String(value) };
}

/** Turns `lastHandledEventSequenceNumber` into `Last Handled Event Sequence Number`. */
function formatKey(key: string): string {
    if (!key) { return key; }
    const spaced = key
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .trim();
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
