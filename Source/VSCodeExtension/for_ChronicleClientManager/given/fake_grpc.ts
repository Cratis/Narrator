// Copyright (c) Cratis. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

import { vi } from 'vitest';

export type Middleware = (call: unknown, options: Record<string, unknown>) => AsyncGenerator<unknown, unknown, unknown>;

export class FakeMetadata {
    private readonly _values = new Map<string, string>();

    set(key: string, value: string): void { this._values.set(key, value); }
    get(key: string): string | undefined { return this._values.get(key); }
}

export class FakeClientError extends Error {
    constructor(public readonly code: number) {
        super('client error');
    }
}

export const UNAUTHENTICATED = 16;

export const state: {
    middleware?: Middleware;
    address?: string;
    credentials?: unknown;
    created: Record<string, { definition: string; channel: unknown }>;
    channel: { close: ReturnType<typeof vi.fn> };
} = {
    created: {},
    channel: { close: vi.fn() },
};

export function resetState(): void {
    state.middleware = undefined;
    state.address = undefined;
    state.credentials = undefined;
    state.created = {};
    state.channel = { close: vi.fn() };
}

export const definitionNames = [
    'EventStores', 'Namespaces', 'Recommendations', 'Identities', 'EventSequences', 'EventTypes',
    'Constraints', 'Observers', 'FailedPartitions', 'Reactors', 'Reducers', 'Projections', 'ReadModels', 'Jobs',
];

export function createContractsModule(): Record<string, string> {
    return Object.fromEntries(definitionNames.map(name => [`${name}Definition`, name]));
}

export function createNiceGrpcModule(): unknown {
    return {
        ChannelCredentials: {
            createInsecure: () => ({ kind: 'insecure' }),
            createSsl: (...args: unknown[]) => ({ kind: 'ssl', args }),
        },
        createChannel: (address: string, credentials: unknown) => {
            state.address = address;
            state.credentials = credentials;
            return state.channel;
        },
        createClientFactory: () => ({
            use(middleware: Middleware) {
                state.middleware = middleware;
                return this;
            },
            create(definition: string, channel: unknown) {
                const client = { definition, channel };
                state.created[definition] = client;
                return client;
            },
        }),
    };
}

export function createNiceGrpcCommonModule(): unknown {
    return {
        Metadata: () => new FakeMetadata(),
        ClientError: FakeClientError,
        Status: { UNAUTHENTICATED },
    };
}

export async function runMiddleware(middleware: Middleware, next: () => unknown): Promise<{ metadata: FakeMetadata; result: unknown }> {
    let metadata: FakeMetadata | undefined;
    const call = {
        request: 'request',
        next: (_request: unknown, options: { metadata: FakeMetadata }) => {
            metadata = options.metadata;
            return {
                [Symbol.asyncIterator]: () => ({
                    next: async () => ({ done: true, value: next() }),
                }),
            };
        },
    };
    const generator = middleware(call, {});
    const step = await generator.next();
    return { metadata: metadata as unknown as FakeMetadata, result: step.value };
}
