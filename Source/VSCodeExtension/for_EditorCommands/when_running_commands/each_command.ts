// Copyright (c) Cratis. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerEditorCommands } from '../../EditorCommands';
import { ChronicleClientManager } from '../../ChronicleClientManager';

const host = vi.hoisted(() => ({
    handlers: new Map<string, (item?: unknown) => unknown>(),
    information: [] as string[],
    warnings: [] as string[],
    documents: [] as unknown[],
    shown: [] as unknown[][],
    statusMessages: [] as unknown[][],
    viewerCalls: [] as unknown[][],
}));

vi.mock('vscode', () => ({
    commands: {
        registerCommand: (id: string, handler: (item?: unknown) => unknown) => {
            host.handlers.set(id, handler);
            return { dispose: () => {} };
        },
    },
    window: {
        showInformationMessage: (message: string) => { host.information.push(message); },
        showWarningMessage: (message: string) => { host.warnings.push(message); },
        showTextDocument: async (...args: unknown[]) => { host.shown.push(args); },
        setStatusBarMessage: (...args: unknown[]) => { host.statusMessages.push(args); },
    },
    workspace: {
        openTextDocument: async (options: unknown) => { host.documents.push(options); return { options }; },
    },
}));

vi.mock('../../EventSequenceViewer', () => ({
    openEventSequenceViewer: (...args: unknown[]) => { host.viewerCalls.push(args); },
}));

const manager = {} as ChronicleClientManager;
const getManager = () => manager;

const item = (data: unknown, extra: Record<string, unknown> = {}) => ({ details: { data }, ...extra });
const run = async (id: string, argument?: unknown) => { await host.handlers.get(id)!(argument); await new Promise(resolve => setTimeout(resolve, 0)); };

beforeEach(() => {
    host.handlers.clear();
    host.information.length = 0;
    host.warnings.length = 0;
    host.documents.length = 0;
    host.shown.length = 0;
    host.statusMessages.length = 0;
    host.viewerCalls.length = 0;
});

describe('when registering editor commands', () => {
    it('should register the four commands', () => {
        const disposables = registerEditorCommands(getManager);
        expect(disposables).toHaveLength(4);
        expect([...host.handlers.keys()]).toEqual([
            'narrator.openEventTypeSchema', 'narrator.openReadModelSchema',
            'narrator.openProjectionDeclaration', 'narrator.openEventSequence',
        ]);
    });
});

describe('when opening an event type schema', () => {
    beforeEach(() => registerEditorCommands(getManager));

    it('should show the pretty printed parsed schema as json', async () => {
        await run('narrator.openEventTypeSchema', item({ id: 'type-1', schema: { a: 1 }, schemaRaw: 'raw' }));
        expect(host.documents).toEqual([{ content: JSON.stringify({ a: 1 }, null, 2), language: 'json' }]);
        expect(host.shown[0][1]).toEqual({ preview: true });
        expect(host.statusMessages).toEqual([['Event Type Schema: type-1', 5000]]);
    });

    it('should fall back to the raw text when nothing is parsed', async () => {
        await run('narrator.openEventTypeSchema', item({ id: 'type-1', schemaRaw: 'raw' }));
        expect(host.documents).toEqual([{ content: 'raw', language: 'json' }]);
    });

    it('should fall back to the raw text when the parsed schema cannot be serialized', async () => {
        await run('narrator.openEventTypeSchema', item({ id: 'type-1', schema: 1n, schemaRaw: 'raw' }));
        expect(host.documents).toEqual([{ content: 'raw', language: 'json' }]);
    });

    it('should say the schema is empty and use unknown when there is no id', async () => {
        await run('narrator.openEventTypeSchema', item({}));
        expect(host.information).toEqual(['Event Type Schema: unknown is empty.']);
        expect(host.documents).toEqual([]);
    });

    it('should do nothing without an item or details', async () => {
        await run('narrator.openEventTypeSchema');
        await run('narrator.openEventTypeSchema', {});
        expect(host.information).toEqual([]);
        expect(host.documents).toEqual([]);
    });
});

describe('when opening a read model schema', () => {
    beforeEach(() => registerEditorCommands(getManager));

    it('should title with the display name', async () => {
        await run('narrator.openReadModelSchema', item({ displayName: 'Display', identifier: 'id', schema: { a: 1 } }));
        expect(host.statusMessages).toEqual([['Read Model Schema: Display', 5000]]);
        expect(host.documents).toEqual([{ content: JSON.stringify({ a: 1 }, null, 2), language: 'json' }]);
    });

    it('should title with the identifier when there is no display name', async () => {
        await run('narrator.openReadModelSchema', item({ identifier: 'id', schemaRaw: 'raw' }));
        expect(host.statusMessages).toEqual([['Read Model Schema: id', 5000]]);
    });

    it('should title with unknown when there is neither', async () => {
        await run('narrator.openReadModelSchema', item({}));
        expect(host.information).toEqual(['Read Model Schema: unknown is empty.']);
    });

    it('should do nothing without details', async () => {
        await run('narrator.openReadModelSchema');
        expect(host.information).toEqual([]);
    });
});

describe('when opening a projection declaration', () => {
    beforeEach(() => registerEditorCommands(getManager));

    it('should show the declaration as plain text', async () => {
        await run('narrator.openProjectionDeclaration', item({ identifier: 'pr', declaration: 'from x' }));
        expect(host.documents).toEqual([{ content: 'from x', language: 'plaintext' }]);
        expect(host.statusMessages).toEqual([['Projection Declaration: pr', 5000]]);
    });

    it('should explain that a model bound projection has no declaration', async () => {
        await run('narrator.openProjectionDeclaration', item({ identifier: 'pr' }));
        expect(host.information).toEqual(["Projection 'pr' has no declarative source — it was registered model-bound."]);
        expect(host.documents).toEqual([]);
    });

    it('should use unknown when the identifier is missing', async () => {
        await run('narrator.openProjectionDeclaration', item({}));
        expect(host.information).toEqual(["Projection 'unknown' has no declarative source — it was registered model-bound."]);
    });

    it('should do nothing without details', async () => {
        await run('narrator.openProjectionDeclaration');
        expect(host.information).toEqual([]);
    });
});

describe('when opening an event sequence', () => {
    beforeEach(() => registerEditorCommands(getManager));
    const missing = 'Cannot open event sequence — missing context.';

    it('should open the viewer for the sequence', async () => {
        await run('narrator.openEventSequence', item({ id: 'event-log', name: 'Event Log' }, { eventStoreName: 'es', namespaceName: 'ns' }));
        expect(host.viewerCalls).toEqual([[getManager, {
            eventStore: 'es', namespace: 'ns', sequenceId: 'event-log', sequenceName: 'Event Log',
        }]]);
    });

    it('should name the sequence after its id when it has no name', async () => {
        await run('narrator.openEventSequence', item({ id: 'event-log' }, { eventStoreName: 'es', namespaceName: 'ns' }));
        expect((host.viewerCalls[0][1] as { sequenceName: string }).sequenceName).toBe('event-log');
    });

    it('should warn when the id, event store or namespace is missing', async () => {
        await run('narrator.openEventSequence');
        await run('narrator.openEventSequence', item({ name: 'x' }, { eventStoreName: 'es', namespaceName: 'ns' }));
        await run('narrator.openEventSequence', item({ id: 'a' }, { namespaceName: 'ns' }));
        await run('narrator.openEventSequence', item({ id: 'a' }, { eventStoreName: 'es' }));
        expect(host.warnings).toEqual([missing, missing, missing, missing]);
        expect(host.viewerCalls).toEqual([]);
    });
});
