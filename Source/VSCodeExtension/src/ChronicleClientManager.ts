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

export interface ObserverEventTypeInfo {
    id: string;
    generation: number;
    tombstone: boolean;
}

export interface ObserverInfo {
    id: string;
    type: string;
    typeCode: number;
    owner: string;
    ownerCode: number;
    runningState: string;
    runningStateCode: number;
    eventSequenceId: string;
    nextEventSequenceNumber: number;
    lastHandledEventSequenceNumber: number;
    isSubscribed: boolean;
    isReplayable: boolean;
    eventTypes: ObserverEventTypeInfo[];
}

export interface FailedPartitionAttemptInfo {
    occurred?: string;
    sequenceNumber: number;
    messages: string[];
    stackTrace: string;
}

export interface FailedPartitionInfo {
    id: string;
    observerId: string;
    partition: string;
    attempts: FailedPartitionAttemptInfo[];
}

export interface JobInfo {
    id: string;
    type: string;
    status: string;
    statusCode: number;
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
    tombstone?: boolean;
    schema?: unknown;
    schemaRaw?: string;
}

export interface ReadModelTypeInfo {
    identifier: string;
    displayName: string;
    containerName?: string;
    schema?: unknown;
    schemaRaw?: string;
    indexes?: string[];
    owner?: string;
    source?: string;
    observerType?: string;
    observerIdentifier?: string;
}

export interface ProjectionInfo {
    identifier: string;
    readModel: string;
    containerName?: string;
    declaration?: string;
}

const OBSERVER_TYPE_NAMES = ['Unknown', 'Reactor', 'Projection', 'Reducer', 'External'];
const OBSERVER_OWNER_NAMES = ['None', 'Client', 'Kernel'];
const OBSERVER_RUNNING_STATE_NAMES = ['Unknown', 'Active', 'Suspended', 'Replaying', 'Disconnected'];
const JOB_STATUS_NAMES = [
    'None',
    'PreparingJob',
    'PreparingSteps',
    'StartingSteps',
    'Running',
    'CompletedSuccessfully',
    'CompletedWithFailures',
    'Stopped',
    'Failed',
    'Removing',
];
const READ_MODEL_OBSERVER_TYPE_NAMES = ['NotSet', 'Reducer', 'Projection'];
const READ_MODEL_OWNER_NAMES = ['None', 'Client', 'Server'];
const READ_MODEL_SOURCE_NAMES = ['Unknown', 'Code', 'User'];

function nameFor(values: readonly string[], code: number): string {
    return values[code] ?? `Unknown(${code})`;
}

function tryParseJson(text: string | undefined): unknown {
    if (!text) { return undefined; }
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
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
        return (resp?.items ?? []).map((j) => {
            const statusCode = j.Status ?? 0;
            return {
                id: j.Id?.value ?? '(unknown)',
                type: j.Type ?? '',
                status: nameFor(JOB_STATUS_NAMES, statusCode),
                statusCode,
            };
        });
    }

    async listObservers(eventStore: string, namespace: string): Promise<ObserverInfo[]> {
        const s = this._services;
        if (!s) { return []; }
        type EventTypeItem = { Id?: string; Generation?: number; Tombstone?: boolean };
        type Item = {
            Id?: string;
            EventSequenceId?: string;
            Type?: number;
            Owner?: number;
            EventTypes?: EventTypeItem[];
            NextEventSequenceNumber?: number;
            LastHandledEventSequenceNumber?: number;
            RunningState?: number;
            IsSubscribed?: boolean;
            IsReplayable?: boolean;
        };
        type Resp = { items?: Item[] };
        const call = s.observers.getObservers.bind(s.observers) as GrpcUnaryMethod<object, Resp>;
        const resp = await grpcCall(call, { EventStore: eventStore, Namespace: namespace });
        return (resp?.items ?? []).map((o) => {
            const typeCode = o.Type ?? 0;
            const ownerCode = o.Owner ?? 0;
            const runningStateCode = o.RunningState ?? 0;
            return {
                id: o.Id ?? '(unknown)',
                type: nameFor(OBSERVER_TYPE_NAMES, typeCode),
                typeCode,
                owner: nameFor(OBSERVER_OWNER_NAMES, ownerCode),
                ownerCode,
                runningState: nameFor(OBSERVER_RUNNING_STATE_NAMES, runningStateCode),
                runningStateCode,
                eventSequenceId: o.EventSequenceId ?? '',
                nextEventSequenceNumber: o.NextEventSequenceNumber ?? 0,
                lastHandledEventSequenceNumber: o.LastHandledEventSequenceNumber ?? 0,
                isSubscribed: o.IsSubscribed ?? false,
                isReplayable: o.IsReplayable ?? false,
                eventTypes: (o.EventTypes ?? []).map((et) => ({
                    id: et.Id ?? '(unknown)',
                    generation: et.Generation ?? 1,
                    tombstone: et.Tombstone ?? false,
                })),
            };
        });
    }

    async listFailedPartitions(eventStore: string, namespace: string): Promise<FailedPartitionInfo[]> {
        const s = this._services;
        if (!s) { return []; }
        type AttemptItem = {
            Occurred?: { Value?: string };
            SequenceNumber?: number;
            Messages?: string[];
            StackTrace?: string;
        };
        type Item = {
            Id?: { value?: string };
            ObserverId?: string;
            Partition?: string;
            Attempts?: AttemptItem[];
        };
        type Resp = { items?: Item[] };
        const call = s.failedPartitions.getFailedPartitions.bind(s.failedPartitions) as GrpcUnaryMethod<object, Resp>;
        const resp = await grpcCall(call, { EventStore: eventStore, Namespace: namespace, ObserverId: '' });
        return (resp?.items ?? []).map((fp) => ({
            id: fp.Id?.value ?? '(unknown)',
            observerId: fp.ObserverId ?? '(unknown)',
            partition: fp.Partition ?? '(unknown)',
            attempts: (fp.Attempts ?? []).map((a) => ({
                occurred: a.Occurred?.Value,
                sequenceNumber: a.SequenceNumber ?? 0,
                messages: a.Messages ?? [],
                stackTrace: a.StackTrace ?? '',
            })),
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
        type Item = {
            Type?: { Id?: string; Generation?: number; Tombstone?: boolean };
            Schema?: string;
        };
        type Resp = { items?: Item[] };
        const call = s.eventTypes.getAllRegistrations.bind(s.eventTypes) as GrpcUnaryMethod<object, Resp>;
        const resp = await grpcCall(call, { EventStore: eventStore });
        return (resp?.items ?? []).map((et) => ({
            id: et.Type?.Id ?? '(unknown)',
            generation: et.Type?.Generation ?? 1,
            tombstone: et.Type?.Tombstone ?? false,
            schema: tryParseJson(et.Schema),
            schemaRaw: et.Schema,
        }));
    }

    async listReadModelTypes(eventStore: string): Promise<ReadModelTypeInfo[]> {
        const s = this._services;
        if (!s) { return []; }
        type Item = {
            Type?: { Identifier?: string; Generation?: number };
            ContainerName?: string;
            DisplayName?: string;
            Schema?: string;
            Indexes?: { PropertyPath?: string }[];
            ObserverType?: number;
            ObserverIdentifier?: string;
            Owner?: number;
            Source?: number;
        };
        type Resp = { ReadModels?: Item[] };
        const call = s.readModels.getDefinitions.bind(s.readModels) as GrpcUnaryMethod<object, Resp>;
        const resp = await grpcCall(call, { EventStore: eventStore });
        return (resp?.ReadModels ?? []).map((rm) => {
            const identifier = rm.Type?.Identifier ?? '(unknown)';
            return {
                identifier,
                displayName: rm.DisplayName ?? identifier,
                containerName: rm.ContainerName,
                schema: tryParseJson(rm.Schema),
                schemaRaw: rm.Schema,
                indexes: (rm.Indexes ?? []).map((idx) => idx.PropertyPath ?? '').filter((p) => p !== ''),
                owner: nameFor(READ_MODEL_OWNER_NAMES, rm.Owner ?? 0),
                source: nameFor(READ_MODEL_SOURCE_NAMES, rm.Source ?? 0),
                observerType: nameFor(READ_MODEL_OBSERVER_TYPE_NAMES, rm.ObserverType ?? 0),
                observerIdentifier: rm.ObserverIdentifier,
            };
        });
    }

    async listProjections(eventStore: string): Promise<ProjectionInfo[]> {
        const s = this._services;
        if (!s) { return []; }
        type DefinitionItem = { Identifier?: string; ReadModel?: string };
        type DefinitionResp = { items?: DefinitionItem[] };
        type DeclarationItem = { Identifier?: string; ContainerName?: string; Declaration?: string };
        type DeclarationResp = { items?: DeclarationItem[] };

        const definitionsCall = s.projections.getAllDefinitions.bind(s.projections) as GrpcUnaryMethod<object, DefinitionResp>;
        const declarationsCall = s.projections.getAllDeclarations.bind(s.projections) as GrpcUnaryMethod<object, DeclarationResp>;

        // Definitions carry the ReadModel association; declarations carry the DSL text. Fetch both
        // in parallel and merge by Identifier so each projection has the structured and source view.
        const [definitions, declarations] = await Promise.all([
            grpcCall(definitionsCall, { EventStore: eventStore }),
            grpcCall(declarationsCall, { EventStore: eventStore }),
        ]);

        const declarationsByIdentifier = new Map<string, DeclarationItem>();
        for (const decl of declarations?.items ?? []) {
            if (decl.Identifier) {
                declarationsByIdentifier.set(decl.Identifier, decl);
            }
        }

        return (definitions?.items ?? []).map((definition) => {
            const identifier = definition.Identifier ?? '(unknown)';
            const decl = declarationsByIdentifier.get(identifier);
            return {
                identifier,
                readModel: definition.ReadModel ?? '',
                containerName: decl?.ContainerName,
                declaration: decl?.Declaration,
            };
        });
    }
}
