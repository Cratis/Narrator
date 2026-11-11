// Copyright (c) Cratis. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExtensionState, registerContextCommands } from '../../ContextCommands';
import { ChronicleTreeDataProvider } from '../../providers/ChronicleTreeDataProvider';
import { host, resetHost } from '../given/host';

vi.mock('vscode', async () => (await import('../given/host')).createVscodeModule());
vi.mock('../../Configuration', async () => (await import('../given/host')).createConfigurationModule());
vi.mock('../../ChronicleClientManager', async () => (await import('../given/host')).createManagerModule());
vi.mock('../../StatusBar', async () => (await import('../given/host')).createStatusBarModule());

let state: ExtensionState;
let treeCalls: { manager: unknown; name: string | undefined; config: string }[];
let existing: { disconnect: () => void };
let effectivePath: string | undefined;

const treeDataProvider = {
    setClientManager: (manager: unknown, name: string | undefined, config: unknown) => {
        treeCalls.push({ manager, name, config: JSON.stringify(config) });
        host.log.push(`tree:${manager ? 'manager' : 'none'}:${name}`);
    },
} as unknown as ChronicleTreeDataProvider;

function setup(activeContextName?: string, withManager = true): void {
    existing = { disconnect: () => host.log.push('disconnect:existing') };
    state = {
        clientManager: withManager ? existing as never : undefined,
        activeContextName,
        outputChannel: {} as never,
    };
    registerContextCommands(state, {} as never, treeDataProvider, () => effectivePath);
}

const run = (id: string, item?: unknown) => host.handlers.get(id)!(item);
const treeItem = (label: unknown) => ({ label });

beforeEach(() => {
    resetHost();
    treeCalls = [];
    effectivePath = '/effective.json';
});

describe('when registering context commands', () => {
    it('should register all five commands', () => {
        setup();
        expect([...host.handlers.keys()]).toEqual([
            'narrator.setContext', 'narrator.addContext', 'narrator.editContext', 'narrator.deleteContext', 'narrator.activateContext',
        ]);
    });
});

describe('when setting the context', () => {
    beforeEach(() => {
        host.config = { activeContext: 'a', contexts: { a: { server: 's-a' }, b: { server: 's-b' } } };
        setup('a');
    });

    it('should warn with the effective config path when there are no contexts', async () => {
        host.config = { contexts: {} };
        await run('narrator.setContext');
        expect(host.log).toEqual(['warn:No contexts found in /effective.json']);
    });

    it('should warn with the default config path when there is no effective path', async () => {
        effectivePath = undefined;
        host.config = { contexts: {} };
        setup('a');
        await run('narrator.setContext');
        expect(host.log).toEqual(['warn:No contexts found in /default/config.json']);
    });

    it('should do nothing when nothing is selected', async () => {
        await run('narrator.setContext');
        expect(host.log).toEqual([]);
        expect(host.quickPickCalls).toEqual([[['a', 'b'], { placeHolder: 'Select active context' }]]);
        expect(host.saved).toEqual([]);
    });

    it('should switch, connect and announce the new context', async () => {
        host.quickPickAnswer = 'b';
        await run('narrator.setContext');
        expect(host.log).toEqual([
            'disconnect:existing', 'new:b', 'status:b:false:true', 'connect:b', 'tree:manager:b', 'status:b:true:false',
            'info:Switched to context: b',
        ]);
        expect(JSON.parse(host.saved[0]).activeContext).toBe('b');
        expect(host.managers[0].context).toEqual({ server: 's-b' });
        expect(state.activeContextName).toBe('b');
        expect(treeCalls[0].config).toContain('"activeContext":"b"');
    });

    it('should report a failed connection', async () => {
        host.quickPickAnswer = 'b';
        host.connectFailure = new Error('down');
        await run('narrator.setContext');
        expect(host.log).toEqual([
            'disconnect:existing', 'new:b', 'status:b:false:true', 'connect:b', 'tree:none:b', 'status:b:false:false',
            'error:Failed to connect to context "b": down',
        ]);
        expect(state.activeContextName).toBe('b');
    });

    it('should report a failed connection with a stringified non-error', async () => {
        host.quickPickAnswer = 'b';
        host.connectFailure = 'plain';
        await run('narrator.setContext');
        expect(host.log.at(-1)).toBe('error:Failed to connect to context "b": plain');
    });

    it('should not disconnect when there is no previous manager', async () => {
        setup('a', false);
        host.quickPickAnswer = 'b';
        await run('narrator.setContext');
        expect(host.log[0]).toBe('new:b');
    });
});

describe('when adding a context', () => {
    beforeEach(() => setup());

    it('should stop when no name is given', async () => {
        host.inputs.push(undefined);
        await run('narrator.addContext');
        expect(host.inputOptions).toHaveLength(1);
        expect(host.saved).toEqual([]);
    });

    it('should stop when no server is given', async () => {
        host.inputs.push('name', '');
        await run('narrator.addContext');
        expect(host.inputOptions).toHaveLength(2);
        expect(host.saved).toEqual([]);
    });

    it('should describe both prompts and validate their input', async () => {
        host.inputs.push('name', 'chronicle://x');
        await run('narrator.addContext');
        const [first, second] = host.inputOptions as { title: string; prompt: string; value?: string; placeHolder: string; validateInput: (v?: string) => string | undefined }[];
        expect([first.title, first.prompt, first.value, first.placeHolder]).toEqual(['Add Chronicle Context (1/2)', 'Context name', '', 'default']);
        expect([second.title, second.prompt, second.placeHolder]).toEqual(['Add Chronicle Context (2/2)', 'Chronicle server URL', 'chronicle://localhost:35000']);
        expect([first.validateInput(' '), first.validateInput(undefined), first.validateInput('x')]).toEqual(['Name is required', 'Name is required', undefined]);
        expect([second.validateInput(' '), second.validateInput('x')]).toEqual(['Server URL is required', undefined]);
    });

    it('should activate and connect the first context without asking', async () => {
        host.inputs.push(' first ', ' chronicle://x ');
        await run('narrator.addContext');
        expect(host.config).toEqual({ activeContext: 'first', contexts: { first: { server: 'chronicle://x' } } });
        expect(host.saved).toHaveLength(2);
        expect(host.quickPickCalls).toEqual([]);
        expect(host.log).toEqual([
            'disconnect:existing', 'new:first', 'status:first:false:true', 'connect:first', 'tree:manager:first', 'status:first:true:false',
        ]);
    });

    it('should report a failed connection', async () => {
        host.inputs.push('first', 'chronicle://x');
        host.connectFailure = new Error('down');
        await run('narrator.addContext');
        expect(host.log.slice(-3)).toEqual(['tree:none:first', 'status:first:false:false', 'error:Failed to connect: down']);
    });

    it('should ask before activating when another context is active', async () => {
        host.config = { activeContext: 'other', contexts: { other: { server: 'o' } } };
        host.inputs.push('second', 'chronicle://y');
        host.quickPickAnswer = 'Yes';
        setup('other');
        await run('narrator.addContext');
        expect(host.quickPickCalls).toEqual([[['Yes', 'No'], { placeHolder: 'Set "second" as the active context?' }]]);
        expect(host.config.activeContext).toBe('second');
        expect(host.log).toContain('connect:second');
    });

    it('should keep the current context when declined', async () => {
        host.config = { activeContext: 'other', contexts: { other: { server: 'o' } } };
        host.inputs.push('second', 'chronicle://y');
        host.quickPickAnswer = 'No';
        setup('other');
        await run('narrator.addContext');
        expect(host.config.activeContext).toBe('other');
        expect(host.saved).toHaveLength(1);
        expect(host.log).toEqual(['tree:manager:other']);
        expect(treeCalls[0].manager).toBe(existing);
        expect(treeCalls[0].config).toContain('second');
    });
});

describe('when editing a context', () => {
    beforeEach(() => {
        host.config = { activeContext: 'a', contexts: { a: { server: 's-a', eventStore: 'es' }, b: { server: 's-b' } } };
    });

    it('should ignore items without a string label', async () => {
        setup('a');
        await run('narrator.editContext');
        await run('narrator.editContext', treeItem({ text: 'x' }));
        expect(host.inputOptions).toEqual([]);
    });

    it('should ignore unknown contexts', async () => {
        setup('a');
        await run('narrator.editContext', treeItem('zzz'));
        expect(host.inputOptions).toEqual([]);
    });

    it('should do nothing when the prompt is cancelled', async () => {
        setup('a');
        host.inputs.push(undefined);
        await run('narrator.editContext', treeItem('a'));
        expect(host.saved).toEqual([]);
        expect(host.inputOptions[0]).toMatchObject({ title: 'Edit Context: a', prompt: 'Chronicle server URL', value: 's-a' });
    });

    it('should save and reconnect the active context', async () => {
        setup('a');
        host.inputs.push(' chronicle://new ');
        await run('narrator.editContext', treeItem('a'));
        expect(host.config.contexts.a).toEqual({ server: 'chronicle://new', eventStore: 'es' });
        expect(host.log).toEqual([
            'disconnect:existing', 'new:a', 'status:a:false:true', 'connect:a', 'tree:manager:a', 'status:a:true:false',
        ]);
    });

    it('should report a failed reconnect', async () => {
        setup('a');
        host.inputs.push('chronicle://new');
        host.connectFailure = new Error('down');
        await run('narrator.editContext', treeItem('a'));
        expect(host.log.slice(-3)).toEqual(['tree:none:a', 'status:a:false:false', 'error:Failed to connect: down']);
    });

    it('should only refresh the tree for an inactive context', async () => {
        setup('a');
        host.inputs.push('chronicle://new');
        await run('narrator.editContext', treeItem('b'));
        expect(host.config.contexts.b.server).toBe('chronicle://new');
        expect(host.log).toEqual(['tree:manager:a']);
        expect(treeCalls[0].manager).toBe(existing);
    });

    it('should use an empty value for a context without a server', async () => {
        host.config = { activeContext: 'a', contexts: { a: {} } };
        setup('a');
        host.inputs.push(undefined);
        await run('narrator.editContext', treeItem('a'));
        expect(host.inputOptions[0].value).toBe('');
    });
});

describe('when deleting a context', () => {
    beforeEach(() => {
        host.config = { activeContext: 'a', contexts: { a: { server: 's-a' }, b: { server: 's-b' } } };
    });

    it('should ignore items without a string label', async () => {
        setup('a');
        await run('narrator.deleteContext');
        expect(host.log).toEqual([]);
    });

    it('should do nothing unless confirmed', async () => {
        setup('a');
        await run('narrator.deleteContext', treeItem('a'));
        expect(host.log).toEqual(['warn:Delete context "a"?']);
        expect(host.saved).toEqual([]);
    });

    it('should delete the active context, disconnect and fall back to the first remaining one', async () => {
        setup('a');
        host.confirmAnswer = 'Delete';
        await run('narrator.deleteContext', treeItem('a'));
        expect(host.config).toEqual({ activeContext: 'b', contexts: { b: { server: 's-b' } } });
        expect(host.log).toEqual(['warn:Delete context "a"?', 'disconnect:existing', 'status:b:false:false', 'tree:none:b']);
        expect(state.clientManager).toBeUndefined();
        expect(state.activeContextName).toBe('b');
    });

    it('should leave no active context after deleting the last one', async () => {
        host.config = { activeContext: 'a', contexts: { a: {} } };
        setup('a');
        host.confirmAnswer = 'Delete';
        await run('narrator.deleteContext', treeItem('a'));
        expect(host.config.activeContext).toBeUndefined();
        expect(host.log.slice(-2)).toEqual(['status:undefined:false:false', 'tree:none:undefined']);
    });

    it('should keep the connection when deleting an inactive context', async () => {
        setup('a');
        host.confirmAnswer = 'Delete';
        await run('narrator.deleteContext', treeItem('b'));
        expect(host.config).toEqual({ activeContext: 'a', contexts: { a: { server: 's-a' } } });
        expect(host.log).toEqual(['warn:Delete context "b"?', 'tree:manager:a']);
        expect(state.clientManager).toBe(existing);
    });

    it('should keep the stored active context when deleting an inactive one that is not stored active', async () => {
        host.config = { activeContext: 'b', contexts: { a: {}, b: {} } };
        setup('a');
        host.confirmAnswer = 'Delete';
        await run('narrator.deleteContext', treeItem('a'));
        expect(host.config.activeContext).toBe('b');
        expect(state.activeContextName).toBe('b');
    });
});

describe('when activating a context', () => {
    beforeEach(() => {
        host.config = { activeContext: 'a', contexts: { a: { server: 's-a' }, b: { server: 's-b' } } };
        setup('a');
    });

    it('should ignore items without a string label and unknown contexts', async () => {
        await run('narrator.activateContext');
        await run('narrator.activateContext', treeItem('zzz'));
        expect(host.log).toEqual([]);
        expect(host.saved).toEqual([]);
    });

    it('should switch, connect and announce the context', async () => {
        await run('narrator.activateContext', treeItem('b'));
        expect(host.config.activeContext).toBe('b');
        expect(host.log).toEqual([
            'disconnect:existing', 'new:b', 'status:b:false:true', 'connect:b', 'tree:manager:b', 'status:b:true:false',
            'info:Switched to context: b',
        ]);
        expect(state.activeContextName).toBe('b');
    });

    it('should report a failed connection', async () => {
        host.connectFailure = new Error('down');
        await run('narrator.activateContext', treeItem('b'));
        expect(host.log.slice(-3)).toEqual(['tree:none:b', 'status:b:false:false', 'error:Failed to connect: down']);
    });
});

describe('when a second context is activated while the first is still connecting', () => {
    let releaseA: () => void;
    let firstActivation: Promise<void>;

    beforeEach(async () => {
        host.config = { activeContext: 'a', contexts: { a: { server: 's-a' }, b: { server: 's-b' } } };
        setup();
        host.connectGates.set('a', new Promise<void>(resolve => { releaseA = resolve; }));
        firstActivation = run('narrator.activateContext', treeItem('a'));
        await run('narrator.activateContext', treeItem('b'));
        host.log.length = 0;
        treeCalls.length = 0;
        releaseA();
        await firstActivation;
    });

    it('should label the tree with the live active context and its client manager', () => {
        expect(treeCalls).toHaveLength(1);
        expect(treeCalls[0].manager).toBe(state.clientManager);
        expect(host.log).toContain('tree:manager:b');
    });

    it('should report the status of the context that finished connecting', () => {
        expect(host.log).toContain('status:a:true:false');
    });

    it('should keep the second context active', () => {
        expect(state.activeContextName).toBe('b');
    });
});
