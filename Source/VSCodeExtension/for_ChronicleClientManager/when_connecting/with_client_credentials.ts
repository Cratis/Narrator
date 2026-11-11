// Copyright (c) Cratis. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChronicleClientManager } from '../../ChronicleClientManager';
import { FakeClientError, resetState, runMiddleware, state, UNAUTHENTICATED } from '../given/fake_grpc';

vi.mock('@cratis/chronicle.contracts', async () => (await import('../given/fake_grpc')).createContractsModule());
vi.mock('nice-grpc', async () => (await import('../given/fake_grpc')).createNiceGrpcModule());
vi.mock('nice-grpc-common', async () => (await import('../given/fake_grpc')).createNiceGrpcCommonModule());

const provider = vi.hoisted(() => ({
    constructed: [] as unknown[][],
    getAccessToken: undefined as unknown as (() => Promise<string | undefined>),
    invalidate: undefined as unknown as (() => void),
}));

vi.mock('../../Auth', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../Auth')>();
    return {
        ...actual,
        CachingTokenProvider: class {
            constructor(...args: unknown[]) { provider.constructed.push(args); }
            getAccessToken() { return provider.getAccessToken(); }
            invalidate() { provider.invalidate(); }
        },
    };
});

const server = 'chronicle://id:pw@example:1234?disableTls=true';

async function connect(): Promise<void> {
    await new ChronicleClientManager('ctx', { server }).connect();
}

describe('when connecting with client credentials', () => {
    beforeEach(async () => {
        resetState();
        provider.constructed = [];
        provider.getAccessToken = async () => 'token-1';
        provider.invalidate = vi.fn();
        vi.spyOn(console, 'log').mockImplementation(() => {});
        await connect();
    });

    it('should create the token provider for the connection', () => {
        expect(provider.constructed).toHaveLength(1);
        expect(provider.constructed[0][1]).toEqual({
            host: 'example', port: 1234, disableTls: true, clientId: 'id', clientSecret: 'pw',
        });
    });

    it('should attach the fetched token as a bearer token', async () => {
        const { metadata } = await runMiddleware(state.middleware!, () => 'ok');
        expect(metadata.get('authorization')).toBe('Bearer token-1');
    });

    it('should invalidate the token when the server answers unauthenticated', async () => {
        const failing = runMiddleware(state.middleware!, () => { throw new FakeClientError(UNAUTHENTICATED); });
        await expect(failing).rejects.toBeInstanceOf(FakeClientError);
        expect(provider.invalidate).toHaveBeenCalledOnce();
    });

    it('should not invalidate the token for other errors', async () => {
        const failing = runMiddleware(state.middleware!, () => { throw new FakeClientError(2); });
        await expect(failing).rejects.toBeInstanceOf(FakeClientError);
        expect(provider.invalidate).not.toHaveBeenCalled();
    });

    it('should rethrow errors that are not client errors', async () => {
        const failing = runMiddleware(state.middleware!, () => { throw new Error('plain'); });
        await expect(failing).rejects.toThrow('plain');
        expect(provider.invalidate).not.toHaveBeenCalled();
    });
});

describe('when the token provider returns no token during a call', () => {
    let metadata: { get(key: string): string | undefined };

    beforeEach(async () => {
        resetState();
        provider.getAccessToken = vi.fn()
            .mockResolvedValueOnce('first')
            .mockResolvedValue(undefined);
        provider.invalidate = vi.fn();
        vi.spyOn(console, 'log').mockImplementation(() => {});
        await connect();
        metadata = (await runMiddleware(state.middleware!, () => 'ok')).metadata;
    });

    it('should not attach an authorization header', () => {
        expect(metadata.get('authorization')).toBeUndefined();
    });
});

describe('when the token provider fails during a call', () => {
    let metadata: { get(key: string): string | undefined };

    beforeEach(async () => {
        resetState();
        provider.getAccessToken = vi.fn()
            .mockResolvedValueOnce('first')
            .mockRejectedValue(new Error('network'));
        provider.invalidate = vi.fn();
        vi.spyOn(console, 'log').mockImplementation(() => {});
        await connect();
        metadata = (await runMiddleware(state.middleware!, () => 'ok')).metadata;
    });

    it('should still perform the call without an authorization header', () => {
        expect(metadata.get('authorization')).toBeUndefined();
    });
});

describe('when the initial token fetch fails', () => {
    let error: Error;

    beforeEach(async () => {
        resetState();
        provider.getAccessToken = async () => { throw new Error('refused'); };
        provider.invalidate = vi.fn();
        vi.spyOn(console, 'log').mockImplementation(() => {});
        error = await connect().then(() => new Error('did not throw'), (reason: Error) => reason);
    });

    it('should fail with the token endpoint message', () => {
        expect(error.message).toBe('Token endpoint unreachable or rejected the request — refused');
    });

    it('should keep the original error as the cause', () => {
        expect((error.cause as Error).message).toBe('refused');
    });

    it('should not create service clients', () => {
        expect(Object.keys(state.created)).toHaveLength(0);
    });
});
