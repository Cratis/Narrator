// Copyright (c) Cratis. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openEventSequenceViewer } from '../../EventSequenceViewer';
import { ChronicleClientManager } from '../../ChronicleClientManager';
import { createEvent, createManager, panels, resetPanels, createCalls } from '../given/fake_panel';

vi.mock('vscode', async () => (await import('../given/fake_panel')).createViewerVscodeModule());

let counter = 0;

function options(overrides: Record<string, string> = {}) {
    counter++;
    return { eventStore: `store${counter}`, namespace: 'ns', sequenceId: 'event-log', sequenceName: 'Event Log', ...overrides };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const sha = (value: string) => createHash('sha256').update(value).digest('hex');

describe('when opening a viewer', () => {
    const calls: unknown[][] = [];
    let viewerOptions = options();

    beforeEach(async () => {
        resetPanels();
        calls.length = 0;
        viewerOptions = options();
        openEventSequenceViewer(() => createManager([createEvent()], calls), viewerOptions);
        await flush();
    });

    it('should create a panel titled with sequence and namespace', () => {
        expect(createCalls[0]).toEqual([
            'narrator.eventSequence', 'Event Log · ns', -1, { enableScripts: true, retainContextWhenHidden: true },
        ]);
    });

    it('should render the self contained html', () => {
        const html = panels[0].webview.html;
        expect(html.startsWith('<!DOCTYPE html>\n<html lang="en">')).toBe(true);
        expect(html).toContain('<title>Event Log</title>');
        expect(html).toContain("script-src 'unsafe-inline';");
        expect(html.endsWith('</script>\n</body>\n</html>')).toBe(true);
    });

    it('should render exactly the pinned html', () => {
        expect([sha(panels[0].webview.html), panels[0].webview.html.length]).toEqual(['a9a4131d08c4e75a5ea56d28b5a91529078d6b20c8009a9f88a9a8a436091e65', 14947]);
    });

    it('should read the tail and the first page', () => {
        expect(calls).toEqual([
            ['tail', viewerOptions.eventStore, 'ns', 'event-log'],
            ['events', viewerOptions.eventStore, 'ns', 'event-log', 0, 49],
        ]);
    });

    it('should post the loaded page with mapped rows', () => {
        expect(panels[0].posted).toEqual([{
            type: 'pageLoaded',
            fromSequenceNumber: 0,
            pageSize: 50,
            tail: 99,
            events: [{
                sequenceNumber: 7,
                eventType: 'type-1',
                eventSourceId: 'sid',
                occurred: '2024-01-01',
                context: {
                    sequenceNumber: 7,
                    eventType: 'type-1 (generation 2)',
                    eventSourceType: 'st',
                    eventSourceId: 'sid',
                    eventStreamType: 'stt',
                    eventStreamId: 'stid',
                    eventStore: 'store',
                    namespace: 'ns',
                    occurred: '2024-01-01',
                    correlationId: 'corr',
                    causedBy: 'name · user · sub',
                    observationState: '3',
                    tags: 'a, b',
                    hash: 'h',
                },
                content: { x: 1 },
            }],
        }]);
    });
});

describe('when opening a viewer whose names need escaping', () => {
    beforeEach(() => {
        resetPanels();
        openEventSequenceViewer(() => undefined, options({ sequenceName: '<a href="x">&\'</a>' }));
    });

    it('should escape the title', () => {
        expect(panels[0].webview.html).toContain('<title>&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;</title>');
    });

    it('should render exactly the pinned html', () => {
        expect(sha(panels[0].webview.html)).toBe('1d211bf013b47ac87d1ee7e32b53d3210a4fbf93fa772861c54865329935adf3');
    });
});

describe('when events are sparse', () => {
    beforeEach(async () => {
        resetPanels();
        const sparse = createEvent({
            eventSourceType: '', eventSourceId: '', eventStreamType: '', eventStreamId: '', occurred: undefined,
            correlationId: undefined, causedBySubject: 'same', causedByName: 'same', causedByUserName: '',
            tags: [], hash: '', content: [1, 2], contentRaw: '[1,2]', observationState: 0,
        });
        const nothingCausedBy = createEvent({
            causedBySubject: undefined, causedByName: undefined, causedByUserName: undefined, content: undefined, contentRaw: 'raw',
        });
        openEventSequenceViewer(() => createManager([sparse, nothingCausedBy]), options());
        await flush();
    });

    it('should apply placeholder values to the context', () => {
        const [row] = (panels[0].posted[0].events as { context: Record<string, unknown>; content: unknown; occurred: unknown }[]);
        expect(row.context).toMatchObject({
            eventSourceType: '(not set)', eventSourceId: '(not set)', eventStreamType: '(not set)', eventStreamId: '(not set)',
            occurred: '(unknown)', correlationId: '(none)', causedBy: 'same', observationState: '0', tags: '(none)', hash: '(none)',
        });
        expect(row.occurred).toBeUndefined();
    });

    it('should fall back to the raw content for arrays and missing content', () => {
        const rows = panels[0].posted[0].events as { content: unknown; context: Record<string, unknown> }[];
        expect(rows[0].content).toBe('[1,2]');
        expect(rows[1].content).toBe('raw');
        expect(rows[1].context.causedBy).toBe('(none)');
    });
});

describe('when requesting a page', () => {
    const calls: unknown[][] = [];

    beforeEach(async () => {
        resetPanels();
        calls.length = 0;
        openEventSequenceViewer(() => createManager([], calls), options());
        await flush();
        calls.length = 0;
        panels[0].posted.length = 0;
    });

    it('should clamp negative starting points to zero', async () => {
        await panels[0].messageHandler({ type: 'loadPage', fromSequenceNumber: -5 });
        expect(calls[1]).toEqual(['events', expect.any(String), 'ns', 'event-log', 0, 49]);
        expect(panels[0].posted[0]).toMatchObject({ type: 'pageLoaded', fromSequenceNumber: 0, events: [] });
    });

    it('should load from the requested sequence number', async () => {
        await panels[0].messageHandler({ type: 'loadPage', fromSequenceNumber: 100 });
        expect(calls[1]).toEqual(['events', expect.any(String), 'ns', 'event-log', 100, 149]);
    });

    it('should ignore other messages', async () => {
        await panels[0].messageHandler({ type: 'other' });
        expect(calls).toEqual([]);
        expect(panels[0].posted).toEqual([]);
    });
});

describe('when loading fails', () => {
    const failing = (error: unknown) => ({
        getEventSequenceTail: async () => { throw error; },
    }) as unknown as ChronicleClientManager;

    it('should post the error message', async () => {
        resetPanels();
        openEventSequenceViewer(() => failing(new Error('boom')), options());
        await flush();
        expect(panels[0].posted).toEqual([{ type: 'pageError', fromSequenceNumber: 0, message: 'boom' }]);
    });

    it('should post a stringified non-error', async () => {
        resetPanels();
        openEventSequenceViewer(() => failing('plain'), options());
        await flush();
        expect(panels[0].posted).toEqual([{ type: 'pageError', fromSequenceNumber: 0, message: 'plain' }]);
    });

    it('should post not connected without a manager', async () => {
        resetPanels();
        openEventSequenceViewer(() => undefined, options());
        await flush();
        expect(panels[0].posted).toEqual([
            { type: 'pageError', fromSequenceNumber: 0, message: 'Not connected to a Chronicle context.' },
        ]);
    });
});

describe('when opening the same viewer twice', () => {
    let viewerOptions = options();

    beforeEach(() => {
        resetPanels();
        viewerOptions = options();
        openEventSequenceViewer(() => undefined, viewerOptions);
        openEventSequenceViewer(() => undefined, viewerOptions);
    });

    it('should reveal the existing panel instead of creating another', () => {
        expect(panels).toHaveLength(1);
        expect(panels[0].reveal).toHaveBeenCalledWith(-1);
    });

    it('should create a new panel after the first is disposed', () => {
        panels[0].disposeHandler();
        openEventSequenceViewer(() => undefined, viewerOptions);
        expect(panels).toHaveLength(2);
    });
});
