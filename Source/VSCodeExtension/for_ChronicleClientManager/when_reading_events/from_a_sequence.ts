// Copyright (c) Cratis. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppendedEventInfo, ChronicleClientManager } from '../../ChronicleClientManager';

const fullEvent = {
    Context: {
        SequenceNumber: 5n,
        EventType: { Id: 'type-1', Generation: 2 },
        EventSourceType: 'src-type',
        EventSourceId: 'src-id',
        EventStreamType: 'stream-type',
        EventStreamId: 'stream-id',
        Occurred: { Value: '2024-01-01T00:00:00Z' },
        CausedBy: { Subject: 'sub', Name: 'name', UserName: 'user' },
        ObservationState: 3,
        Tags: ['a'],
        Hash: 'hash',
    },
    Content: '{"x":1}',
};

function createManager(response: unknown, calls: unknown[]): ChronicleClientManager {
    const manager = new ChronicleClientManager('ctx', {});
    (manager as unknown as { _services: unknown })._services = {
        eventSequences: {
            fromSequenceNumber: async (request: unknown) => { calls.push(request); return response; },
        },
    };
    return manager;
}

describe('when reading events from a sequence', () => {
    let result: AppendedEventInfo[];
    let calls: unknown[];

    beforeEach(async () => {
        calls = [];
        const manager = createManager({
            Data: [
                fullEvent,
                { Context: { SequenceNumber: 9n } },
                {},
            ],
        }, calls);
        result = await manager.getEventsFromSequence('store', 'ns', 'event-log', 5, 6);
    });

    it('should request from the first sequence number', () => {
        expect(calls).toEqual([{
            EventStore: 'store', Namespace: 'ns', EventSequenceId: 'event-log',
            FromEventSequenceNumber: 5n, EventSourceId: '', EventTypeIds: '',
        }]);
    });

    it('should clamp the page to the upper bound', () => {
        expect(result.map(event => event.sequenceNumber)).toEqual([5, 0]);
    });

    it('should map a full event', () => {
        expect(result[0]).toEqual({
            sequenceNumber: 5,
            eventTypeId: 'type-1',
            eventTypeGeneration: 2,
            eventSourceType: 'src-type',
            eventSourceId: 'src-id',
            eventStreamType: 'stream-type',
            eventStreamId: 'stream-id',
            eventStore: 'store',
            namespace: 'ns',
            occurred: '2024-01-01T00:00:00Z',
            correlationId: undefined,
            causedBySubject: 'sub',
            causedByName: 'name',
            causedByUserName: 'user',
            observationState: 3,
            tags: ['a'],
            hash: 'hash',
            content: { x: 1 },
            contentRaw: '{"x":1}',
        });
    });

    it('should default the fields of a sparse event', () => {
        expect(result[1]).toEqual({
            sequenceNumber: 0,
            eventTypeId: '(unknown)',
            eventTypeGeneration: 1,
            eventSourceType: '',
            eventSourceId: '',
            eventStreamType: '',
            eventStreamId: '',
            eventStore: 'store',
            namespace: 'ns',
            occurred: undefined,
            correlationId: undefined,
            causedBySubject: undefined,
            causedByName: undefined,
            causedByUserName: undefined,
            observationState: 0,
            tags: [],
            hash: '',
            content: undefined,
            contentRaw: '',
        });
    });
});

describe('when reading events without a connection', () => {
    let result: AppendedEventInfo[];

    beforeEach(async () => {
        vi.restoreAllMocks();
        result = await new ChronicleClientManager('ctx', {}).getEventsFromSequence('s', 'n', 'e', 0, 1);
    });

    it('should return no events', () => {
        expect(result).toEqual([]);
    });
});
