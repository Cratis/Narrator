// Copyright (c) Cratis. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import { URL } from 'url';
import { Context } from './Configuration';

// Mirrors the Cratis CLI authentication flow so the extension reads/writes the same files
// (~/.cratis/config.json, ~/.cratis/tokens/<context>_<user>.token) and can transparently
// share session state with the CLI.

const DEVELOPMENT_CLIENT_ID = 'chronicle-dev-client';
const DEVELOPMENT_CLIENT_SECRET = 'chronicle-dev-secret';
const DEFAULT_CHRONICLE_PORT = 35000;
const TOKEN_LIFETIME_MINUTES = 55;
const TOKEN_REFRESH_MARGIN_MS = 60_000;

export enum AuthMode {
    None = 'none',
    ApiKey = 'apiKey',
    ClientCredentials = 'clientCredentials',
}

export interface ParsedConnection {
    host: string;
    port: number;
    username?: string;
    password?: string;
    apiKey?: string;
    disableTls: boolean;
    authMode: AuthMode;
}

interface CachedTokenFile {
    AccessToken: string;
    Expiry: string;
}

export interface CachedToken {
    accessToken: string;
    expiry: Date;
}

/** Mirrors `ChronicleSettings.ComposeCredentials` — fills the connection string with the right credentials. */
export function composeEffectiveConnectionString(context: Context): string {
    const server = context.server && context.server.trim() !== ''
        ? context.server
        : 'chronicle://localhost:35000';

    if (hasEmbeddedAuth(server)) {
        return server;
    }

    if (context.accessToken && isContextTokenValid(context.tokenExpiry)) {
        return appendApiKey(server, context.accessToken);
    }

    if (context.clientId && context.clientSecret) {
        return insertCredentials(server, context.clientId, context.clientSecret);
    }

    return insertCredentials(server, DEVELOPMENT_CLIENT_ID, DEVELOPMENT_CLIENT_SECRET);
}

/** Parses a Chronicle connection string into host/port/auth components. */
export function parseConnection(connectionString: string): ParsedConnection {
    const url = new URL(connectionString);
    const host = url.hostname || 'localhost';
    const port = url.port ? parseInt(url.port, 10) : DEFAULT_CHRONICLE_PORT;
    const disableTls = url.searchParams.get('disableTls') === 'true';
    const apiKeyRaw = url.searchParams.get('apiKey');
    const apiKey = apiKeyRaw ? apiKeyRaw : undefined;
    const username = url.username ? decodeURIComponent(url.username) : undefined;
    const password = url.password ? decodeURIComponent(url.password) : undefined;

    let authMode = AuthMode.None;
    if (apiKey) {
        authMode = AuthMode.ApiKey;
    } else if (username && password) {
        authMode = AuthMode.ClientCredentials;
    }

    return { host, port, username, password, apiKey, disableTls, authMode };
}

export function getTokenCachePath(contextName: string, username: string): string {
    const safeKey = sanitizeFileName(`${contextName}_${username}`);
    return path.join(os.homedir(), '.cratis', 'tokens', `${safeKey}.token`);
}

export function readCachedToken(cachePath: string): CachedToken | undefined {
    if (!fs.existsSync(cachePath)) {
        return undefined;
    }
    try {
        const raw = fs.readFileSync(cachePath, 'utf-8');
        const parsed = JSON.parse(raw) as CachedTokenFile;
        const expiry = new Date(parsed.Expiry);
        if (isNaN(expiry.getTime())) {
            return undefined;
        }
        return { accessToken: parsed.AccessToken, expiry };
    } catch {
        return undefined;
    }
}

export function writeCachedToken(cachePath: string, token: CachedToken): void {
    const dir = path.dirname(cachePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    const payload: CachedTokenFile = {
        AccessToken: token.accessToken,
        Expiry: token.expiry.toISOString(),
    };
    fs.writeFileSync(cachePath, JSON.stringify(payload), 'utf-8');
}

export function deleteCachedToken(cachePath: string): void {
    try {
        if (fs.existsSync(cachePath)) {
            fs.unlinkSync(cachePath);
        }
    } catch {
        // best-effort
    }
}

export interface TokenRequest {
    host: string;
    port: number;
    disableTls: boolean;
    clientId: string;
    clientSecret: string;
}

export interface TokenResponse {
    accessToken: string;
    expiresIn: number;
}

/** Performs an OAuth client_credentials request against the Chronicle server's `/connect/token` endpoint. */
export async function fetchAccessToken(request: TokenRequest): Promise<TokenResponse> {
    const scheme = request.disableTls ? 'http' : 'https';
    const endpoint = `${scheme}://${request.host}:${request.port}/connect/token`;

    const params = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: request.clientId,
        client_secret: request.clientSecret,
    }).toString();

    const { status, statusText, body } = await postForm(endpoint, params);

    if (status < 200 || status >= 300) {
        throw new Error(`OAuth token request failed: ${status} ${statusText} - ${body}`);
    }

    const data = JSON.parse(body) as { access_token?: string; expires_in?: number };
    if (!data.access_token) {
        throw new Error('OAuth token response missing access_token');
    }
    return { accessToken: data.access_token, expiresIn: data.expires_in ?? 3600 };
}

/** Token provider that mirrors `FileSystemCachingTokenProvider` on disk so the CLI and extension share tokens. */
export class CachingTokenProvider {
    private _inflight: Promise<string | undefined> | undefined;

    constructor(
        private readonly _cachePath: string,
        private readonly _request: TokenRequest,
        private readonly _log: (msg: string) => void,
    ) {}

    async getAccessToken(): Promise<string | undefined> {
        const cached = readCachedToken(this._cachePath);
        if (cached && cached.expiry.getTime() > Date.now() + TOKEN_REFRESH_MARGIN_MS) {
            return cached.accessToken;
        }

        if (this._inflight) {
            return this._inflight;
        }

        this._inflight = (async () => {
            try {
                this._log(`[Chronicle] Requesting OAuth token from ${this._request.host}:${this._request.port} (client_id=${this._request.clientId})`);
                const response = await fetchAccessToken(this._request);
                const expiry = new Date(Date.now() + TOKEN_LIFETIME_MINUTES * 60_000);
                writeCachedToken(this._cachePath, { accessToken: response.accessToken, expiry });
                this._log(`[Chronicle] OAuth token acquired, cached at ${this._cachePath}`);
                return response.accessToken;
            } finally {
                this._inflight = undefined;
            }
        })();

        return this._inflight;
    }

    invalidate(): void {
        deleteCachedToken(this._cachePath);
    }
}

function hasEmbeddedAuth(connectionString: string): boolean {
    const scheme = 'chronicle://';
    if (!connectionString.toLowerCase().startsWith(scheme)) {
        return false;
    }
    const afterScheme = connectionString.substring(scheme.length);
    const queryStart = afterScheme.indexOf('?');
    const hostPart = queryStart >= 0 ? afterScheme.substring(0, queryStart) : afterScheme;
    if (hostPart.includes('@')) {
        return true;
    }
    return connectionString.toLowerCase().includes('apikey=');
}

function appendApiKey(connectionString: string, apiKey: string): string {
    const separator = connectionString.includes('?') ? '&' : '?';
    return `${connectionString}${separator}apiKey=${encodeURIComponent(apiKey)}`;
}

function insertCredentials(connectionString: string, clientId: string, clientSecret: string): string {
    const scheme = 'chronicle://';
    if (!connectionString.toLowerCase().startsWith(scheme)) {
        return connectionString;
    }
    return `${scheme}${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}@${connectionString.substring(scheme.length)}`;
}

function isContextTokenValid(expiry?: string): boolean {
    if (!expiry) {
        return false;
    }
    const date = Date.parse(expiry);
    if (isNaN(date)) {
        return false;
    }
    return date > Date.now() + TOKEN_REFRESH_MARGIN_MS;
}

function sanitizeFileName(name: string): string {
    return name.replace(/[\\/:*?"<>|]/g, '_');
}

interface HttpResponse {
    status: number;
    statusText: string;
    body: string;
}

function postForm(endpoint: string, body: string): Promise<HttpResponse> {
    return new Promise((resolve, reject) => {
        const url = new URL(endpoint);
        const isHttps = url.protocol === 'https:';
        const options: https.RequestOptions = {
            method: 'POST',
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 80),
            path: `${url.pathname}${url.search}`,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(body).toString(),
            },
        };
        if (isHttps) {
            // Mirror the CLI's OAuthTokenProvider — accept self-signed and name-mismatch certs
            // so local Chronicle servers without a real cert chain still work.
            (options as https.RequestOptions).rejectUnauthorized = false;
        }
        const lib = isHttps ? https : http;
        const request = lib.request(options, (response) => {
            const chunks: Buffer[] = [];
            response.on('data', (chunk: Buffer) => chunks.push(chunk));
            response.on('end', () => {
                resolve({
                    status: response.statusCode ?? 0,
                    statusText: response.statusMessage ?? '',
                    body: Buffer.concat(chunks).toString('utf-8'),
                });
            });
        });
        request.on('error', reject);
        request.write(body);
        request.end();
    });
}
