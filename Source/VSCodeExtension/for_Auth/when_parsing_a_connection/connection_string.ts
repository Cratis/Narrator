// Copyright (c) Cratis. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

import { describe, expect, it } from 'vitest';
import { AuthMode, parseConnection } from '../../Auth';

describe('when parsing a connection string', () => {
    it('should default the port and use no authentication', () => {
        expect(parseConnection('chronicle://example')).toEqual({
            host: 'example', port: 35000, username: undefined, password: undefined,
            apiKey: undefined, disableTls: false, authMode: AuthMode.None,
        });
    });

    it('should read the explicit port and disabled TLS', () => {
        expect(parseConnection('chronicle://example:1234?disableTls=true')).toMatchObject({
            host: 'example', port: 1234, disableTls: true,
        });
    });

    it('should not disable TLS for other values', () => {
        expect(parseConnection('chronicle://example?disableTls=false').disableTls).toBe(false);
    });

    it('should use the api key mode', () => {
        expect(parseConnection('chronicle://example?apiKey=secret')).toMatchObject({
            apiKey: 'secret', authMode: AuthMode.ApiKey,
        });
    });

    it('should use the client credentials mode with decoded values', () => {
        expect(parseConnection('chronicle://my%40id:p%3Aw@example')).toMatchObject({
            username: 'my@id', password: 'p:w', authMode: AuthMode.ClientCredentials,
        });
    });

    it('should prefer the api key over credentials', () => {
        expect(parseConnection('chronicle://id:pw@example?apiKey=k').authMode).toBe(AuthMode.ApiKey);
    });

    it('should ignore an empty api key', () => {
        expect(parseConnection('chronicle://example?apiKey=')).toMatchObject({ apiKey: undefined, authMode: AuthMode.None });
    });

    it('should need both username and password for client credentials', () => {
        expect(parseConnection('chronicle://id@example')).toMatchObject({ username: 'id', password: undefined, authMode: AuthMode.None });
        expect(parseConnection('chronicle://:pw@example')).toMatchObject({ username: undefined, password: 'pw', authMode: AuthMode.None });
    });
});
