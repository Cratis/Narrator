import type * as ContractsModule from '@cratis/chronicle.contracts';
import type * as vscode from 'vscode';
import { Context } from './Configuration';
import {
    AuthMode,
    CachingTokenProvider,
    composeEffectiveConnectionString,
    getTokenCachePath,
    parseConnection,
    resolveManagementPort,
} from './Auth';

function formatError(error: unknown): string {
    if (error instanceof Error) {
        const code = (error as { code?: string }).code;
        const message = error.message && error.message.trim() !== '' ? error.message : error.name;
        return code ? `${code} ${message}` : message;
    }
    if (error === undefined || error === null) {
        return '(no error details)';
    }
    return String(error);
}

// ── gRPC service client bundle ───────────────────────────────────────────────

interface ChronicleServices {
    eventStores: ContractsModule.EventStoresClient;
    namespaces: ContractsModule.NamespacesClient;
    recommendations: ContractsModule.RecommendationsClient;
    identities: ContractsModule.IdentitiesClient;
    eventSequences: ContractsModule.EventSequencesClient;
    eventTypes: ContractsModule.EventTypesClient;
    constraints: ContractsModule.ConstraintsClient;
    observers: ContractsModule.ObserversClient;
    failedPartitions: ContractsModule.FailedPartitionsClient;
    reactors: ContractsModule.ReactorsClient;
    reducers: ContractsModule.ReducersClient;
    projections: ContractsModule.ProjectionsClient;
    readModels: ContractsModule.ReadModelsClient;
    jobs: ContractsModule.JobsClient;
}

// ── gRPC call helper ─────────────────────────────────────────────────────────

type GrpcUnaryMethod<TReq, TResp> = (
    request: TReq,
    callback: (err: Error | null, response: TResp | undefined) => void
) => void;

/** Wraps a gRPC unary call in a Promise */
function grpcCall<TReq, TResp>(
    method: GrpcUnaryMethod<TReq, TResp>,
    request: TReq
): Promise<TResp | undefined> {
    return new Promise((resolve, reject) => {
        method(request, (err, resp) => {
            if (err) { reject(err); } else { resolve(resp); }
        });
    });
}

export interface ObserverInfo {
    id: string;
    type: string;
    runningState: string;
}

export interface FailedPartitionInfo {
    id: string;
    observerId: string;
    partition: string;
}

export interface JobInfo {
    id: string;
    type: string;
    status: string;
}

export interface RecommendationInfo {
    id: string;
    name: string;
    type: string;
}

export interface IdentityInfo {
    subject: string;
    name: string;
    userName: string;
}

export interface EventTypeInfo {
    id: string;
    generation: number;
}

export interface ReadModelTypeInfo {
    identifier: string;
    displayName: string;
}

export interface ProjectionInfo {
    identifier: string;
    readModel: string;
}

export class ChronicleClientManager {
    private _services: ChronicleServices | undefined;
    private _tokenProvider: CachingTokenProvider | undefined;
    private readonly _context: Context;
    private readonly _contextName: string;
    private readonly _log: (msg: string) => void;

    constructor(contextName: string, context: Context, outputChannel?: vscode.OutputChannel) {
        this._context = context;
        this._contextName = contextName;
        this._log = (msg: string) => {
            const line = `${new Date().toISOString()} ${msg}`;
            outputChannel?.appendLine(line);
            console.log(line);
        };
    }

    async connect(): Promise<void> {
        const [contracts, grpc] = await Promise.all([
            import('@cratis/chronicle.contracts'),
            import('@grpc/grpc-js'),
        ]);

        // Compose the effective connection string the same way the CLI does — embedded creds
        // win, then cached login token, then context client id/secret, then dev defaults.
        const effectiveConnectionString = composeEffectiveConnectionString(this._context);
        const parsed = parseConnection(effectiveConnectionString);
        const address = `${parsed.host}:${parsed.port}`;

        this._log(`[Chronicle] Connecting to ${address} (TLS=${!parsed.disableTls})`);

        const channelCredentials = parsed.disableTls
            ? grpc.credentials.createInsecure()
            : grpc.credentials.createSsl();

        let apiKey: string | undefined;
        this._tokenProvider = undefined;

        switch (parsed.authMode) {
            case AuthMode.ApiKey:
                this._log('[Chronicle] Auth mode: API key');
                apiKey = parsed.apiKey;
                break;
            case AuthMode.ClientCredentials: {
                const managementPort = resolveManagementPort(this._context);
                this._log(`[Chronicle] Auth mode: client_credentials (clientId=${parsed.username}, managementPort=${managementPort})`);
                const cachePath = getTokenCachePath(this._contextName, parsed.username ?? '');
                this._tokenProvider = new CachingTokenProvider(
                    cachePath,
                    {
                        host: parsed.host,
                        managementPort,
                        disableTls: parsed.disableTls,
                        clientId: parsed.username ?? '',
                        clientSecret: parsed.password ?? '',
                    },
                    this._log,
                );
                // Eagerly fetch the token so connect() fails fast when auth is broken,
                // instead of every later gRPC call returning UNAUTHENTICATED.
                try {
                    await this._tokenProvider.getAccessToken();
                } catch (error) {
                    const detail = formatError(error);
                    this._log(`[Chronicle] Initial token fetch failed: ${detail}`);
                    throw new Error(`Token endpoint unreachable or rejected the request — ${detail}`);
                }
                break;
            }
            case AuthMode.None:
                this._log('[Chronicle] Auth mode: none');
                break;
        }

        const log = this._log.bind(this);
        const tokenProvider = this._tokenProvider;

        // Auth interceptor — adds Bearer token (or API key) to every gRPC call.
        // Using an interceptor avoids the grpc-js restriction that forbids
        // combining insecure channel credentials with call credentials.
        const interceptors: import('@grpc/grpc-js').Interceptor[] = [];
        if (tokenProvider) {
            interceptors.push((options, nextCall) => {
                return new grpc.InterceptingCall(nextCall(options), {
                    start(metadata, listener, next) {
                        tokenProvider.getAccessToken()
                            .then(token => {
                                if (token) {
                                    metadata.add('authorization', `Bearer ${token}`);
                                } else {
                                    log('[Chronicle] WARNING: token provider returned no token');
                                }
                                next(metadata, {
                                    onReceiveStatus(status, nextStatus) {
                                        if (status.code === grpc.status.UNAUTHENTICATED) {
                                            log('[Chronicle] Server returned UNAUTHENTICATED — clearing cached token');
                                            tokenProvider.invalidate();
                                        }
                                        nextStatus(status);
                                    },
                                });
                            })
                            .catch((error: unknown) => {
                                log(`[Chronicle] ERROR fetching token: ${error instanceof Error ? error.message : String(error)}`);
                                next(metadata, listener);
                            });
                    },
                });
            });
        } else if (apiKey) {
            const key = apiKey;
            interceptors.push((options, nextCall) => {
                return new grpc.InterceptingCall(nextCall(options), {
                    start(metadata, listener, next) {
                        metadata.add('authorization', `Bearer ${key}`);
                        next(metadata, listener);
                    },
                });
            });
        }

        const clientOptions = interceptors.length > 0 ? { interceptors } : undefined;

        this._services = {
            eventStores: new contracts.EventStoresClient(address, channelCredentials, clientOptions),
            namespaces: new contracts.NamespacesClient(address, channelCredentials, clientOptions),
            recommendations: new contracts.RecommendationsClient(address, channelCredentials, clientOptions),
            identities: new contracts.IdentitiesClient(address, channelCredentials, clientOptions),
            eventSequences: new contracts.EventSequencesClient(address, channelCredentials, clientOptions),
            eventTypes: new contracts.EventTypesClient(address, channelCredentials, clientOptions),
            constraints: new contracts.ConstraintsClient(address, channelCredentials, clientOptions),
            observers: new contracts.ObserversClient(address, channelCredentials, clientOptions),
            failedPartitions: new contracts.FailedPartitionsClient(address, channelCredentials, clientOptions),
            reactors: new contracts.ReactorsClient(address, channelCredentials, clientOptions),
            reducers: new contracts.ReducersClient(address, channelCredentials, clientOptions),
            projections: new contracts.ProjectionsClient(address, channelCredentials, clientOptions),
            readModels: new contracts.ReadModelsClient(address, channelCredentials, clientOptions),
            jobs: new contracts.JobsClient(address, channelCredentials, clientOptions),
        };

        this._log('[Chronicle] All gRPC service clients created. Connection ready.');
    }

    disconnect(): void {
        if (this._services) {
            // Close all underlying gRPC channels.
            for (const client of Object.values(this._services)) {
                try {
                    (client as import('@grpc/grpc-js').Client).close();
                } catch {
                    // Best-effort close.
                }
            }
        }
        this._services = undefined;
    }

    get isConnected(): boolean {
        return this._services !== undefined;
    }

    // ── Event stores ────────────────────────────────────────────────────────

    async listEventStores(): Promise<string[]> {
        const s = this._services;
        if (!s) { return []; }
        type Resp = { items?: string[] };
        const call = s.eventStores.getEventStores.bind(s.eventStores) as GrpcUnaryMethod<object, Resp>;
        const resp = await grpcCall(call, {});
        return resp?.items ?? [];
    }

    // ── Namespaces ───────────────────────────────────────────────────────────

    async listNamespaces(eventStore: string): Promise<string[]> {
        const s = this._services;
        if (!s) { return []; }
        type Resp = { items?: string[] };
        const call = s.namespaces.getNamespaces.bind(s.namespaces) as GrpcUnaryMethod<object, Resp>;
        const resp = await grpcCall(call, { EventStore: eventStore });
        return resp?.items ?? [];
    }

    // ── Namespace-scoped ─────────────────────────────────────────────────────

    async listRecommendations(eventStore: string, namespace: string): Promise<RecommendationInfo[]> {
        const s = this._services;
        if (!s) { return []; }
        type Item = { Id?: { value?: string }; Name?: string; Type?: string };
        type Resp = { items?: Item[] };
        const call = s.recommendations.getRecommendations.bind(s.recommendations) as GrpcUnaryMethod<object, Resp>;
        const resp = await grpcCall(call, { EventStore: eventStore, Namespace: namespace });
        return (resp?.items ?? []).map((r) => ({
            id: r.Id?.value ?? '(unknown)',
            name: r.Name ?? '(unknown)',
            type: r.Type ?? '',
        }));
    }

    async listJobs(eventStore: string, namespace: string): Promise<JobInfo[]> {
        const s = this._services;
        if (!s) { return []; }
        type Item = { Id?: { value?: string }; Type?: string; Status?: number };
        type Resp = { items?: Item[] };
        const call = s.jobs.getJobs.bind(s.jobs) as GrpcUnaryMethod<object, Resp>;
        const resp = await grpcCall(call, { EventStore: eventStore, Namespace: namespace });
        return (resp?.items ?? []).map((j) => ({
            id: j.Id?.value ?? '(unknown)',
            type: j.Type ?? '',
            status: String(j.Status ?? 0),
        }));
    }

    async listObservers(eventStore: string, namespace: string): Promise<ObserverInfo[]> {
        const s = this._services;
        if (!s) { return []; }
        type Item = { Id?: string; Type?: number; RunningState?: number };
        type Resp = { items?: Item[] };
        const call = s.observers.getObservers.bind(s.observers) as GrpcUnaryMethod<object, Resp>;
        const resp = await grpcCall(call, { EventStore: eventStore, Namespace: namespace });
        return (resp?.items ?? []).map((o) => ({
            id: o.Id ?? '(unknown)',
            type: String(o.Type ?? 0),
            runningState: String(o.RunningState ?? 0),
        }));
    }

    async listFailedPartitions(eventStore: string, namespace: string): Promise<FailedPartitionInfo[]> {
        const s = this._services;
        if (!s) { return []; }
        type Item = { Id?: { value?: string }; ObserverId?: string; Partition?: string };
        type Resp = { items?: Item[] };
        const call = s.failedPartitions.getFailedPartitions.bind(s.failedPartitions) as GrpcUnaryMethod<object, Resp>;
        const resp = await grpcCall(call, { EventStore: eventStore, Namespace: namespace, ObserverId: '' });
        return (resp?.items ?? []).map((fp) => ({
            id: fp.Id?.value ?? '(unknown)',
            observerId: fp.ObserverId ?? '(unknown)',
            partition: fp.Partition ?? '(unknown)',
        }));
    }

    async listIdentities(eventStore: string, namespace: string): Promise<IdentityInfo[]> {
        const s = this._services;
        if (!s) { return []; }
        type Item = { Subject?: string; Name?: string; UserName?: string };
        type Resp = { items?: Item[] };
        const call = s.identities.getIdentities.bind(s.identities) as GrpcUnaryMethod<object, Resp>;
        const resp = await grpcCall(call, { EventStore: eventStore, Namespace: namespace });
        return (resp?.items ?? []).map((i) => ({
            subject: i.Subject ?? '(unknown)',
            name: i.Name ?? '(unknown)',
            userName: i.UserName ?? '',
        }));
    }

    // ── Event-store level (General) ──────────────────────────────────────────

    async listEventTypes(eventStore: string): Promise<EventTypeInfo[]> {
        const s = this._services;
        if (!s) { return []; }
        type Item = { Id?: string; Generation?: number };
        type Resp = { items?: Item[] };
        const call = s.eventTypes.getAll.bind(s.eventTypes) as GrpcUnaryMethod<object, Resp>;
        const resp = await grpcCall(call, { EventStore: eventStore });
        return (resp?.items ?? []).map((et) => ({
            id: et.Id ?? '(unknown)',
            generation: et.Generation ?? 1,
        }));
    }

    async listReadModelTypes(eventStore: string): Promise<ReadModelTypeInfo[]> {
        const s = this._services;
        if (!s) { return []; }
        type Item = { Identifier?: string; DisplayName?: string };
        type Resp = { ReadModels?: Item[] };
        const call = s.readModels.getDefinitions.bind(s.readModels) as GrpcUnaryMethod<object, Resp>;
        const resp = await grpcCall(call, { EventStore: eventStore });
        return (resp?.ReadModels ?? []).map((rm) => ({
            identifier: rm.Identifier ?? '(unknown)',
            displayName: rm.DisplayName ?? rm.Identifier ?? '(unknown)',
        }));
    }

    async listProjections(eventStore: string): Promise<ProjectionInfo[]> {
        const s = this._services;
        if (!s) { return []; }
        type Item = { Identifier?: string; ReadModel?: string };
        type Resp = { items?: Item[] };
        const call = s.projections.getAllDefinitions.bind(s.projections) as GrpcUnaryMethod<object, Resp>;
        const resp = await grpcCall(call, { EventStore: eventStore });
        return (resp?.items ?? []).map((p) => ({
            identifier: p.Identifier ?? '(unknown)',
            readModel: p.ReadModel ?? '',
        }));
    }
}
