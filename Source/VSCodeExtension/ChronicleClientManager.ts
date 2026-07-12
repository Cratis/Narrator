// Copyright (c) Cratis. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

import type {
    ConstraintsClient,
    EventSequencesClient,
    EventStoresClient,
    EventTypesClient,
    FailedPartitionsClient,
    IdentitiesClient,
    JobsClient,
    NamespacesClient,
    ObserversClient,
    ProjectionsClient,
    ReactorsClient,
    ReadModelsClient,
    RecommendationsClient,
    ReducersClient,
} from '@cratis/chronicle.contracts';
import type { Channel } from 'nice-grpc';
import type * as vscode from 'vscode';
import { Context } from './Configuration';
import {
    AuthMode,
    CachingTokenProvider,
    composeEffectiveConnectionString,
    getTokenCachePath,
    parseConnection,
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

// ── Sentinel helpers ─────────────────────────────────────────────────────────

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Convert a bigint sequence number to a plain number. Chronicle uses `ulong.MaxValue`
 * (2^64-1) as the "no events yet" sentinel; anything above MAX_SAFE_INTEGER is treated
 * as the sentinel and reported as MAX_SAFE_INTEGER. Real sequence numbers cannot
 * legitimately exceed 2^53 (~9 quadrillion events), so clamping has no observable
 * effect on real data.
 */
function bigintToNumber(value: bigint): number {
    if (value > MAX_SAFE_BIGINT) { return Number.MAX_SAFE_INTEGER; }
    if (value < -MAX_SAFE_BIGINT) { return Number.MIN_SAFE_INTEGER; }
    return Number(value);
}

// ── gRPC service client bundle ───────────────────────────────────────────────

interface ChronicleServices {
    channel: Channel;
    eventStores: EventStoresClient;
    namespaces: NamespacesClient;
    recommendations: RecommendationsClient;
    identities: IdentitiesClient;
    eventSequences: EventSequencesClient;
    eventTypes: EventTypesClient;
    constraints: ConstraintsClient;
    observers: ObserversClient;
    failedPartitions: FailedPartitionsClient;
    reactors: ReactorsClient;
    reducers: ReducersClient;
    projections: ProjectionsClient;
    readModels: ReadModelsClient;
    jobs: JobsClient;
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

export interface EventSequenceInfo {
    /** Wire-level identifier sent to gRPC calls. */
    id: string;
    /** Friendly display name for the explorer. */
    name: string;
    /** Short description shown next to the name. */
    description: string;
}

export interface AppendedEventInfo {
    sequenceNumber: number;
    eventTypeId: string;
    eventTypeGeneration: number;
    eventSourceType: string;
    eventSourceId: string;
    eventStreamType: string;
    eventStreamId: string;
    eventStore: string;
    namespace: string;
    occurred?: string;
    correlationId?: string;
    causedBySubject?: string;
    causedByName?: string;
    causedByUserName?: string;
    observationState: number;
    tags: string[];
    hash: string;
    content: unknown;
    contentRaw: string;
}

/**
 * Well-known event sequences shipped with Cratis Chronicle. The IDs are plain string slugs on
 * the wire — they're not GUIDs. See https://github.com/Cratis/Chronicle for the canonical list.
 */
const WELL_KNOWN_EVENT_SEQUENCES: EventSequenceInfo[] = [
    { id: 'event-log', name: 'Event Log', description: 'Default event log' },
    { id: 'outbox',    name: 'Outbox',    description: 'Outgoing integration events' },
    { id: 'system',    name: 'System',    description: 'Internal system events' },
];

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
        const [contracts, niceGrpc, niceGrpcCommon] = await Promise.all([
            import('@cratis/chronicle.contracts'),
            import('nice-grpc'),
            import('nice-grpc-common'),
        ]);

        // Compose the effective connection string the same way the CLI does — embedded creds
        // win, then cached login token, then context client id/secret, then dev defaults.
        const effectiveConnectionString = composeEffectiveConnectionString(this._context);
        const parsed = parseConnection(effectiveConnectionString);
        const address = `${parsed.host}:${parsed.port}`;

        this._log(`[Chronicle] Connecting to ${address} (TLS=${!parsed.disableTls})`);

        // Use nice-grpc's bundled `@grpc/grpc-js` credentials so they match the channel type
        // nice-grpc expects — the top-level grpc-js install ships its own duplicate types.
        // The Kernel's single port is TLS-only and, in development, serves a self-signed
        // certificate. `@grpc/grpc-js` has no per-error hook to bypass just the untrusted-root
        // case, so — mirroring the TypeScript Chronicle client — skip chain validation entirely
        // whenever TLS is enabled, since this client never pins an expected server certificate.
        const channelCredentials = parsed.disableTls
            ? niceGrpc.ChannelCredentials.createInsecure()
            : niceGrpc.ChannelCredentials.createSsl(null, null, null, { rejectUnauthorized: false });

        let apiKey: string | undefined;
        this._tokenProvider = undefined;

        switch (parsed.authMode) {
            case AuthMode.ApiKey:
                this._log('[Chronicle] Auth mode: API key');
                apiKey = parsed.apiKey;
                break;
            case AuthMode.ClientCredentials: {
                this._log(`[Chronicle] Auth mode: client_credentials (clientId=${parsed.username})`);
                const cachePath = getTokenCachePath(this._contextName, parsed.username ?? '');
                this._tokenProvider = new CachingTokenProvider(
                    cachePath,
                    {
                        host: parsed.host,
                        port: parsed.port,
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
                    throw new Error(`Token endpoint unreachable or rejected the request — ${detail}`, { cause: error });
                }
                break;
            }
            case AuthMode.None:
                this._log('[Chronicle] Auth mode: none');
                break;
        }

        const log = this._log.bind(this);
        const tokenProvider = this._tokenProvider;

        // Auth middleware — attaches Bearer/API-key to every outbound call and invalidates
        // the cached token on UNAUTHENTICATED so the next call refetches.
        const authMiddleware: import('nice-grpc-common').ClientMiddleware = async function* (call, options) {
            const metadata = niceGrpcCommon.Metadata(options.metadata);
            if (tokenProvider) {
                try {
                    const token = await tokenProvider.getAccessToken();
                    if (token) {
                        metadata.set('authorization', `Bearer ${token}`);
                    } else {
                        log('[Chronicle] WARNING: token provider returned no token');
                    }
                } catch (error) {
                    log(`[Chronicle] ERROR fetching token: ${error instanceof Error ? error.message : String(error)}`);
                }
            } else if (apiKey) {
                metadata.set('authorization', `Bearer ${apiKey}`);
            }
            try {
                return yield* call.next(call.request, { ...options, metadata });
            } catch (error) {
                if (
                    error instanceof niceGrpcCommon.ClientError &&
                    error.code === niceGrpcCommon.Status.UNAUTHENTICATED &&
                    tokenProvider
                ) {
                    log('[Chronicle] Server returned UNAUTHENTICATED — clearing cached token');
                    tokenProvider.invalidate();
                }
                throw error;
            }
        };

        const channel = niceGrpc.createChannel(address, channelCredentials);
        const factory = niceGrpc.createClientFactory().use(authMiddleware);

        this._services = {
            channel,
            eventStores: factory.create(contracts.EventStoresDefinition, channel),
            namespaces: factory.create(contracts.NamespacesDefinition, channel),
            recommendations: factory.create(contracts.RecommendationsDefinition, channel),
            identities: factory.create(contracts.IdentitiesDefinition, channel),
            eventSequences: factory.create(contracts.EventSequencesDefinition, channel),
            eventTypes: factory.create(contracts.EventTypesDefinition, channel),
            constraints: factory.create(contracts.ConstraintsDefinition, channel),
            observers: factory.create(contracts.ObserversDefinition, channel),
            failedPartitions: factory.create(contracts.FailedPartitionsDefinition, channel),
            reactors: factory.create(contracts.ReactorsDefinition, channel),
            reducers: factory.create(contracts.ReducersDefinition, channel),
            projections: factory.create(contracts.ProjectionsDefinition, channel),
            readModels: factory.create(contracts.ReadModelsDefinition, channel),
            jobs: factory.create(contracts.JobsDefinition, channel),
        };

        this._log('[Chronicle] All gRPC service clients created. Connection ready.');
    }

    disconnect(): void {
        if (this._services) {
            try { this._services.channel.close(); } catch { /* best-effort */ }
        }
        this._services = undefined;
    }

    get isConnected(): boolean {
        return this._services !== undefined;
    }

    // ── Event stores ────────────────────────────────────────────────────────

    async listEventStores(): Promise<string[]> {
        const services = this._services;
        if (!services) { return []; }
        const response = await services.eventStores.getEventStores({});
        return response.items ?? [];
    }

    // ── Namespaces ───────────────────────────────────────────────────────────

    async listNamespaces(eventStore: string): Promise<string[]> {
        const services = this._services;
        if (!services) { return []; }
        const response = await services.namespaces.getNamespaces({ EventStore: eventStore });
        return response.items ?? [];
    }

    // ── Namespace-scoped ─────────────────────────────────────────────────────

    async listRecommendations(eventStore: string, namespace: string): Promise<RecommendationInfo[]> {
        const services = this._services;
        if (!services) { return []; }
        const response = await services.recommendations.getRecommendations({ EventStore: eventStore, Namespace: namespace });
        return (response.items ?? []).map((recommendation) => ({
            id: '(unknown)',
            name: recommendation.Name ?? '(unknown)',
            type: recommendation.Type ?? '',
        }));
    }

    async listJobs(eventStore: string, namespace: string): Promise<JobInfo[]> {
        const services = this._services;
        if (!services) { return []; }
        const response = await services.jobs.getJobs({ EventStore: eventStore, Namespace: namespace });
        return (response.items ?? []).map((job) => {
            const statusCode = job.Status ?? 0;
            return {
                id: '(unknown)',
                type: job.Type ?? '',
                status: nameFor(JOB_STATUS_NAMES, statusCode),
                statusCode,
            };
        });
    }

    async listObservers(eventStore: string, namespace: string): Promise<ObserverInfo[]> {
        const services = this._services;
        if (!services) { return []; }
        const response = await services.observers.getObservers({ EventStore: eventStore, Namespace: namespace });
        return (response.items ?? []).map((observer) => {
            const typeCode = observer.Type ?? 0;
            const ownerCode = observer.Owner ?? 0;
            const runningStateCode = observer.RunningState ?? 0;
            return {
                id: observer.Id ?? '(unknown)',
                type: nameFor(OBSERVER_TYPE_NAMES, typeCode),
                typeCode,
                owner: nameFor(OBSERVER_OWNER_NAMES, ownerCode),
                ownerCode,
                runningState: nameFor(OBSERVER_RUNNING_STATE_NAMES, runningStateCode),
                runningStateCode,
                eventSequenceId: observer.EventSequenceId ?? '',
                nextEventSequenceNumber: bigintToNumber(observer.NextEventSequenceNumber ?? 0n),
                lastHandledEventSequenceNumber: bigintToNumber(observer.LastHandledEventSequenceNumber ?? 0n),
                isSubscribed: observer.IsSubscribed ?? false,
                isReplayable: observer.IsReplayable ?? false,
                eventTypes: (observer.EventTypes ?? []).map((eventType) => ({
                    id: eventType.Id ?? '(unknown)',
                    generation: eventType.Generation ?? 1,
                    tombstone: eventType.Tombstone ?? false,
                })),
            };
        });
    }

    async listFailedPartitions(eventStore: string, namespace: string): Promise<FailedPartitionInfo[]> {
        const services = this._services;
        if (!services) { return []; }
        const response = await services.failedPartitions.getFailedPartitions({
            EventStore: eventStore,
            Namespace: namespace,
            ObserverId: '',
        });
        return (response.items ?? []).map((failedPartition) => ({
            id: '(unknown)',
            observerId: failedPartition.ObserverId ?? '(unknown)',
            partition: failedPartition.Partition ?? '(unknown)',
            attempts: (failedPartition.Attempts ?? []).map((attempt) => ({
                occurred: attempt.Occurred?.Value,
                sequenceNumber: bigintToNumber(attempt.SequenceNumber ?? 0n),
                messages: attempt.Messages ?? [],
                stackTrace: attempt.StackTrace ?? '',
            })),
        }));
    }

    async listIdentities(eventStore: string, namespace: string): Promise<IdentityInfo[]> {
        const services = this._services;
        if (!services) { return []; }
        const response = await services.identities.getIdentities({ EventStore: eventStore, Namespace: namespace });
        return (response.items ?? []).map((identity) => ({
            subject: identity.Subject ?? '(unknown)',
            name: identity.Name ?? '(unknown)',
            userName: identity.UserName ?? '',
        }));
    }

    // ── Event-store level (General) ──────────────────────────────────────────

    async listEventTypes(eventStore: string): Promise<EventTypeInfo[]> {
        const services = this._services;
        if (!services) { return []; }
        const response = await services.eventTypes.getAllRegistrations({ EventStore: eventStore });
        return (response.items ?? []).map((registration) => ({
            id: registration.Type?.Id ?? '(unknown)',
            generation: registration.Type?.Generation ?? 1,
            tombstone: registration.Type?.Tombstone ?? false,
            schema: tryParseJson(registration.Schema),
            schemaRaw: registration.Schema,
        }));
    }

    async listReadModelTypes(eventStore: string): Promise<ReadModelTypeInfo[]> {
        const services = this._services;
        if (!services) { return []; }
        const response = await services.readModels.getDefinitions({ EventStore: eventStore });
        return (response.ReadModels ?? []).map((readModel) => {
            const identifier = readModel.Type?.Identifier ?? '(unknown)';
            return {
                identifier,
                displayName: readModel.DisplayName ?? identifier,
                containerName: readModel.ContainerName,
                schema: tryParseJson(readModel.Schema),
                schemaRaw: readModel.Schema,
                indexes: (readModel.Indexes ?? []).map((index) => index.PropertyPath ?? '').filter((path) => path !== ''),
                owner: nameFor(READ_MODEL_OWNER_NAMES, readModel.Owner ?? 0),
                source: nameFor(READ_MODEL_SOURCE_NAMES, readModel.Source ?? 0),
                observerType: nameFor(READ_MODEL_OBSERVER_TYPE_NAMES, readModel.ObserverType ?? 0),
                observerIdentifier: readModel.ObserverIdentifier,
            };
        });
    }

    async listProjections(eventStore: string): Promise<ProjectionInfo[]> {
        const services = this._services;
        if (!services) { return []; }
        // Definitions carry the ReadModel association; declarations carry the DSL text. Fetch both
        // in parallel and merge by Identifier so each projection has the structured and source view.
        const [definitions, declarations] = await Promise.all([
            services.projections.getAllDefinitions({ EventStore: eventStore }),
            services.projections.getAllDeclarations({ EventStore: eventStore }),
        ]);

        const declarationsByIdentifier = new Map<string, { ContainerName: string; Declaration: string }>();
        for (const declaration of declarations.items ?? []) {
            if (declaration.Identifier) {
                declarationsByIdentifier.set(declaration.Identifier, {
                    ContainerName: declaration.ContainerName,
                    Declaration: declaration.Declaration,
                });
            }
        }

        return (definitions.items ?? []).map((definition) => {
            const identifier = definition.Identifier ?? '(unknown)';
            const declaration = declarationsByIdentifier.get(identifier);
            return {
                identifier,
                readModel: definition.ReadModel ?? '',
                containerName: declaration?.ContainerName,
                declaration: declaration?.Declaration,
            };
        });
    }

    // ── Event sequences ──────────────────────────────────────────────────────

    /**
     * Returns the well-known event sequences for a namespace. The gRPC contract has no listing
     * RPC, so we surface the constant set Chronicle ships with — additional custom sequences are
     * still reachable by their ID through any other API that takes an `EventSequenceId`.
     */
    listEventSequences(): EventSequenceInfo[] {
        return WELL_KNOWN_EVENT_SEQUENCES.map((sequence) => ({ ...sequence }));
    }

    async getEventSequenceTail(eventStore: string, namespace: string, eventSequenceId: string): Promise<number> {
        const services = this._services;
        if (!services) { return 0; }
        const response = await services.eventSequences.getTailSequenceNumber({
            EventStore: eventStore,
            Namespace: namespace,
            EventSequenceId: eventSequenceId,
            EventTypes: [],
            EventSourceId: '',
            EventSourceType: '',
            EventStreamId: '',
            EventStreamType: '',
        });
        return bigintToNumber(response.SequenceNumber ?? 0n);
    }

    async getEventsFromSequence(
        eventStore: string,
        namespace: string,
        eventSequenceId: string,
        fromSequenceNumber: number,
        toSequenceNumber: number
    ): Promise<AppendedEventInfo[]> {
        const services = this._services;
        if (!services) { return []; }
        const response = await services.eventSequences.getEventsFromEventSequenceNumber({
            EventStore: eventStore,
            Namespace: namespace,
            EventSequenceId: eventSequenceId,
            FromEventSequenceNumber: BigInt(fromSequenceNumber),
            ToEventSequenceNumber: BigInt(toSequenceNumber),
            EventSourceId: '',
            EventTypes: [],
        });
        return (response.Events ?? []).map((event) => {
            const context = event.Context;
            const causedBy = context?.CausedBy;
            const contentRaw = event.Content ?? '';
            return {
                sequenceNumber: bigintToNumber(context?.SequenceNumber ?? 0n),
                eventTypeId: context?.EventType?.Id ?? '(unknown)',
                eventTypeGeneration: context?.EventType?.Generation ?? 1,
                eventSourceType: context?.EventSourceType ?? '',
                eventSourceId: context?.EventSourceId ?? '',
                eventStreamType: context?.EventStreamType ?? '',
                eventStreamId: context?.EventStreamId ?? '',
                eventStore: context?.EventStore ?? '',
                namespace: context?.Namespace ?? '',
                occurred: context?.Occurred?.Value,
                correlationId: undefined,
                causedBySubject: causedBy?.Subject,
                causedByName: causedBy?.Name,
                causedByUserName: causedBy?.UserName,
                observationState: context?.ObservationState ?? 0,
                tags: context?.Tags ?? [],
                hash: context?.Hash ?? '',
                content: tryParseJson(contentRaw),
                contentRaw,
            };
        });
    }
}
