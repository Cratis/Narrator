// Copyright (c) Cratis. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

import { BinaryReader, WireType } from '@bufbuild/protobuf/wire';
import { EventType, ObserverInformation } from '@cratis/chronicle.contracts';

// @cratis/chronicle.contracts is generated with ts-proto's `forceLong=number`, so its
// decoder rejects any uint64 value greater than Number.MAX_SAFE_INTEGER. Chronicle uses
// EventSequenceNumber.MaxValue (ulong.MaxValue, 2^64-1) as a sentinel for "no events yet",
// which trips this guard and breaks every observer-related call. This module replaces the
// affected decoder with one that clamps overflowing values instead of throwing.

function clampToSafeInteger(value: bigint | string | number): number {
    const num = Number(typeof value === 'bigint' ? value.toString() : value);
    if (num > Number.MAX_SAFE_INTEGER) return Number.MAX_SAFE_INTEGER;
    if (num < Number.MIN_SAFE_INTEGER) return Number.MIN_SAFE_INTEGER;
    return num;
}

type ObserverInformationMessage = ReturnType<typeof ObserverInformation.decode>;

function createEmpty(): ObserverInformationMessage {
    return {
        Id: '',
        EventSequenceId: '',
        Type: 0,
        Owner: 0,
        EventTypes: [],
        NextEventSequenceNumber: 0,
        LastHandledEventSequenceNumber: 0,
        RunningState: 0,
        IsSubscribed: false,
        IsReplayable: false,
    } as ObserverInformationMessage;
}

function safeObserverInformationDecode(input: BinaryReader | Uint8Array, length?: number): ObserverInformationMessage {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    const message = createEmpty();
    while (reader.pos < end) {
        const tag = reader.uint32();
        const fieldNumber = tag >>> 3;
        const wireType = (tag & 7) as WireType;
        switch (fieldNumber) {
            case 1:
                if (tag === 10) { message.Id = reader.string(); continue; }
                break;
            case 2:
                if (tag === 18) { message.EventSequenceId = reader.string(); continue; }
                break;
            case 3:
                if (tag === 24) { message.Type = reader.int32(); continue; }
                break;
            case 4:
                if (tag === 32) { message.Owner = reader.int32(); continue; }
                break;
            case 5:
                if (tag === 42) { message.EventTypes.push(EventType.decode(reader, reader.uint32())); continue; }
                break;
            case 6:
                if (tag === 48) { message.NextEventSequenceNumber = clampToSafeInteger(reader.uint64()); continue; }
                break;
            case 7:
                if (tag === 56) { message.LastHandledEventSequenceNumber = clampToSafeInteger(reader.uint64()); continue; }
                break;
            case 8:
                if (tag === 64) { message.RunningState = reader.int32(); continue; }
                break;
            case 9:
                if (tag === 72) { message.IsSubscribed = reader.bool(); continue; }
                break;
            case 10:
                if (tag === 80) { message.IsReplayable = reader.bool(); continue; }
                break;
        }
        if (wireType === WireType.EndGroup || tag === 0) {
            break;
        }
        reader.skip(wireType);
    }
    return message;
}

/**
 * Installs runtime patches against `@cratis/chronicle.contracts` to work around
 * known incompatibilities between the generated decoders and the values Chronicle
 * actually sends on the wire. Must be called once during extension activation.
 */
export function applyProtoPatches(): void {
    (ObserverInformation as { decode: typeof safeObserverInformationDecode }).decode =
        safeObserverInformationDecode;
}
