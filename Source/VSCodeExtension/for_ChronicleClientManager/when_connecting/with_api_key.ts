// Copyright (c) Cratis. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChronicleClientManager } from '../../ChronicleClientManager';
import { definitionNames, resetState, runMiddleware, state } from '../given/fake_grpc';

vi.mock('@cratis/chronicle.contracts', async () => (await import('../given/fake_grpc')).createContractsModule());
vi.mock('nice-grpc', async () => (await import('../given/fake_grpc')).createNiceGrpcModule());
vi.mock('nice-grpc-common', async () => (await import('../given/fake_grpc')).createNiceGrpcCommonModule());

describe('when connecting with an api key and TLS disabled', () => {
    let manager: ChronicleClientManager;
    let logged: string[];

    beforeEach(async () => {
        resetState();
        logged = [];
        vi.spyOn(console, 'log').mockImplementation(() => {});
        manager = new ChronicleClientManager('ctx', { server: 'chronicle://example:1234?apiKey=secret&disableTls=true' }, {
            appendLine: (line: string) => logged.push(line),
        } as never);
        await manager.connect();
    });

    it('should connect to the host and port', () => {
        expect(state.address).toBe('example:1234');
    });

    it('should use insecure credentials', () => {
        expect(state.credentials).toEqual({ kind: 'insecure' });
    });

    it('should create every service client on the channel', () => {
        expect(Object.keys(state.created).sort()).toEqual([...definitionNames].sort());
        expect(Object.values(state.created).every(client => client.channel === state.channel)).toBe(true);
    });

    it('should log the auth mode and readiness', () => {
        expect(logged.some(line => line.includes('[Chronicle] Auth mode: API key'))).toBe(true);
        expect(logged.some(line => line.includes('[Chronicle] All gRPC service clients created. Connection ready.'))).toBe(true);
    });

    it('should attach the api key as a bearer token', async () => {
        const { metadata } = await runMiddleware(state.middleware!, () => 'ok');
        expect(metadata.get('authorization')).toBe('Bearer secret');
    });

    it('should close the channel on disconnect', () => {
        manager.disconnect();
        expect(state.channel.close).toHaveBeenCalledOnce();
    });

    it('should swallow channel close failures on disconnect', () => {
        state.channel.close.mockImplementation(() => { throw new Error('boom'); });
        expect(() => manager.disconnect()).not.toThrow();
    });
});

describe('when connecting with an api key and TLS enabled', () => {
    beforeEach(async () => {
        resetState();
        vi.spyOn(console, 'log').mockImplementation(() => {});
        await new ChronicleClientManager('ctx', { server: 'chronicle://example?apiKey=secret' }).connect();
    });

    it('should use the default port', () => {
        expect(state.address).toBe('example:35000');
    });

    it('should use ssl credentials that skip chain validation', () => {
        expect(state.credentials).toEqual({ kind: 'ssl', args: [null, null, null, { rejectUnauthorized: false }] });
    });
});
