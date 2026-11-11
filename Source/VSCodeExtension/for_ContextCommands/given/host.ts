// Copyright (c) Cratis. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

import { Configuration } from '../../Configuration';

/** Shared recording state for the mocked host; every observable interaction is appended to `log`. */
export const host = {
    handlers: new Map<string, (item?: unknown) => Promise<void>>(),
    log: [] as string[],
    config: { contexts: {} } as Configuration,
    saved: [] as string[],
    inputs: [] as (string | undefined)[],
    inputOptions: [] as Record<string, unknown>[],
    quickPickAnswer: undefined as string | undefined,
    quickPickCalls: [] as unknown[][],
    confirmAnswer: undefined as string | undefined,
    connectFailure: undefined as unknown,
    connectGates: new Map<string, Promise<void>>(),
    managers: [] as { name: string; context: unknown; connected: boolean; disconnected: boolean }[],
    loadedPaths: [] as unknown[],
};

export function resetHost(): void {
    host.handlers.clear();
    host.log.length = 0;
    host.config = { contexts: {} };
    host.saved.length = 0;
    host.inputs.length = 0;
    host.inputOptions.length = 0;
    host.quickPickAnswer = undefined;
    host.quickPickCalls.length = 0;
    host.confirmAnswer = undefined;
    host.connectFailure = undefined;
    host.connectGates.clear();
    host.managers.length = 0;
    host.loadedPaths.length = 0;
}

export function createVscodeModule(): Record<string, unknown> {
    return {
        commands: {
            registerCommand: (id: string, handler: (item?: unknown) => Promise<void>) => {
                host.handlers.set(id, handler);
                return { dispose: () => {} };
            },
        },
        window: {
            showInputBox: async (options: Record<string, unknown>) => {
                host.inputOptions.push(options);
                return host.inputs.shift();
            },
            showQuickPick: async (...args: unknown[]) => { host.quickPickCalls.push(args); return host.quickPickAnswer; },
            showWarningMessage: async (message: string) => { host.log.push(`warn:${message}`); return host.confirmAnswer; },
            showInformationMessage: (message: string) => { host.log.push(`info:${message}`); },
            showErrorMessage: (message: string) => { host.log.push(`error:${message}`); },
        },
    };
}

export function createConfigurationModule(): Record<string, unknown> {
    return {
        getConfigPath: () => '/default/config.json',
        loadConfiguration: (path?: unknown) => {
            host.loadedPaths.push(path);
            return structuredClone(host.config);
        },
        saveConfiguration: (config: Configuration) => {
            host.saved.push(JSON.stringify(config));
            host.config = structuredClone(config);
        },
    };
}

export function createManagerModule(): Record<string, unknown> {
    class FakeManager {
        private readonly _record: { name: string; context: unknown; connected: boolean; disconnected: boolean };
        constructor(name: string, context: unknown) {
            this._record = { name, context, connected: false, disconnected: false };
            host.managers.push(this._record);
            host.log.push(`new:${name}`);
        }
        async connect(): Promise<void> {
            host.log.push(`connect:${this._record.name}`);
            await host.connectGates.get(this._record.name);
            if (host.connectFailure !== undefined) { throw host.connectFailure; }
            this._record.connected = true;
        }
        disconnect(): void {
            this._record.disconnected = true;
            host.log.push(`disconnect:${this._record.name}`);
        }
    }
    return { ChronicleClientManager: FakeManager };
}

export function createStatusBarModule(): Record<string, unknown> {
    return {
        updateStatusBar: (_item: unknown, name: string | undefined, connected: boolean, connecting = false) => {
            host.log.push(`status:${name}:${connected}:${connecting}`);
        },
    };
}
