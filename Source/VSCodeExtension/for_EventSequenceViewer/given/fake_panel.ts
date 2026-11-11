// Copyright (c) Cratis. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

import { vi } from 'vitest';
import { AppendedEventInfo, ChronicleClientManager } from '../../ChronicleClientManager';

export class FakePanel {
    readonly posted: Record<string, unknown>[] = [];
    readonly reveal = vi.fn();
    disposeHandler: () => void = () => {};
    messageHandler: (message: unknown) => Promise<void> = async () => {};
    readonly webview = {
        html: '',
        postMessage: (message: Record<string, unknown>) => { this.posted.push(message); return Promise.resolve(true); },
        onDidReceiveMessage: (handler: (message: unknown) => Promise<void>) => { this.messageHandler = handler; },
    };

    onDidDispose(handler: () => void): void { this.disposeHandler = handler; }
}

export const panels: FakePanel[] = [];
export const createCalls: unknown[][] = [];

export function resetPanels(): void {
    panels.length = 0;
    createCalls.length = 0;
}

export function createViewerVscodeModule(): Record<string, unknown> {
    return {
        ViewColumn: { Active: -1 },
        window: {
            createWebviewPanel: (...args: unknown[]) => {
                createCalls.push(args);
                const panel = new FakePanel();
                panels.push(panel);
                return panel;
            },
        },
    };
}

export function createEvent(overrides: Partial<AppendedEventInfo> = {}): AppendedEventInfo {
    return {
        sequenceNumber: 7,
        eventTypeId: 'type-1',
        eventTypeGeneration: 2,
        eventSourceType: 'st',
        eventSourceId: 'sid',
        eventStreamType: 'stt',
        eventStreamId: 'stid',
        eventStore: 'store',
        namespace: 'ns',
        occurred: '2024-01-01',
        correlationId: 'corr',
        causedBySubject: 'sub',
        causedByName: 'name',
        causedByUserName: 'user',
        observationState: 3,
        tags: ['a', 'b'],
        hash: 'h',
        content: { x: 1 },
        contentRaw: '{"x":1}',
        ...overrides,
    };
}

export function createManager(events: AppendedEventInfo[], calls: unknown[][] = []): ChronicleClientManager {
    return {
        getEventSequenceTail: async (...args: unknown[]) => { calls.push(['tail', ...args]); return 99; },
        getEventsFromSequence: async (...args: unknown[]) => { calls.push(['events', ...args]); return events; },
    } as unknown as ChronicleClientManager;
}
