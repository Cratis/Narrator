import { CliContext } from './CliConfiguration';

type ChronicleConnectionType = InstanceType<typeof import('@cratis/chronicle.contracts').ChronicleConnection>;

function buildConnectionString(context: CliContext): string {
    if (!context.server) {
        throw new Error('No server configured in the active context');
    }

    const serverUrl = new URL(context.server);
    if (context.clientId && context.clientSecret) {
        serverUrl.username = encodeURIComponent(context.clientId);
        serverUrl.password = encodeURIComponent(context.clientSecret);
    }
    return serverUrl.toString();
}

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
    private _connection: ChronicleConnectionType | undefined;
    private readonly _context: CliContext;

    constructor(context: CliContext) {
        this._context = context;
    }

    async connect(): Promise<void> {
        const { ChronicleConnection } = await import('@cratis/chronicle.contracts');
        const connectionString = buildConnectionString(this._context);
        this._connection = new ChronicleConnection({
            connectionString,
            ...(this._context.managementPort !== undefined && {
                managementPort: this._context.managementPort,
            }),
        });
    }

    disconnect(): void {
        this._connection = undefined;
    }

    getConnection(): ChronicleConnectionType | undefined {
        return this._connection;
    }

    get isConnected(): boolean {
        return this._connection !== undefined;
    }

    // ── Event stores ────────────────────────────────────────────────────────

    async listEventStores(): Promise<string[]> {
        const c = this._connection;
        if (!c) { return []; }
        type Resp = { items?: string[] };
        const call = c.eventStores.getEventStores.bind(c.eventStores) as GrpcUnaryMethod<object, Resp>;
        const resp = await grpcCall(call, {});
        return resp?.items ?? [];
    }

    // ── Namespaces ───────────────────────────────────────────────────────────

    async listNamespaces(eventStore: string): Promise<string[]> {
        const c = this._connection;
        if (!c) { return []; }
        type Resp = { items?: string[] };
        const call = c.namespaces.getNamespaces.bind(c.namespaces) as GrpcUnaryMethod<object, Resp>;
        const resp = await grpcCall(call, { EventStore: eventStore });
        return resp?.items ?? [];
    }

    // ── Namespace-scoped ─────────────────────────────────────────────────────

    async listRecommendations(eventStore: string, namespace: string): Promise<RecommendationInfo[]> {
        const c = this._connection;
        if (!c) { return []; }
        type Item = { Id?: { value?: string }; Name?: string; Type?: string };
        type Resp = { items?: Item[] };
        const call = c.recommendations.getRecommendations.bind(c.recommendations) as GrpcUnaryMethod<object, Resp>;
        const resp = await grpcCall(call, { EventStore: eventStore, Namespace: namespace });
        return (resp?.items ?? []).map((r) => ({
            id: r.Id?.value ?? '(unknown)',
            name: r.Name ?? '(unknown)',
            type: r.Type ?? '',
        }));
    }

    async listJobs(eventStore: string, namespace: string): Promise<JobInfo[]> {
        const c = this._connection;
        if (!c) { return []; }
        type Item = { Id?: { value?: string }; Type?: string; Status?: number };
        type Resp = { items?: Item[] };
        const call = c.jobs.getJobs.bind(c.jobs) as GrpcUnaryMethod<object, Resp>;
        const resp = await grpcCall(call, { EventStore: eventStore, Namespace: namespace });
        return (resp?.items ?? []).map((j) => ({
            id: j.Id?.value ?? '(unknown)',
            type: j.Type ?? '',
            status: String(j.Status ?? 0),
        }));
    }

    async listObservers(eventStore: string, namespace: string): Promise<ObserverInfo[]> {
        const c = this._connection;
        if (!c) { return []; }
        type Item = { Id?: string; Type?: number; RunningState?: number };
        type Resp = { items?: Item[] };
        const call = c.observers.getObservers.bind(c.observers) as GrpcUnaryMethod<object, Resp>;
        const resp = await grpcCall(call, { EventStore: eventStore, Namespace: namespace });
        return (resp?.items ?? []).map((o) => ({
            id: o.Id ?? '(unknown)',
            type: String(o.Type ?? 0),
            runningState: String(o.RunningState ?? 0),
        }));
    }

    async listFailedPartitions(eventStore: string, namespace: string): Promise<FailedPartitionInfo[]> {
        const c = this._connection;
        if (!c) { return []; }
        type Item = { Id?: { value?: string }; ObserverId?: string; Partition?: string };
        type Resp = { items?: Item[] };
        const call = c.failedPartitions.getFailedPartitions.bind(c.failedPartitions) as GrpcUnaryMethod<object, Resp>;
        const resp = await grpcCall(call, { EventStore: eventStore, Namespace: namespace, ObserverId: '' });
        return (resp?.items ?? []).map((fp) => ({
            id: fp.Id?.value ?? '(unknown)',
            observerId: fp.ObserverId ?? '(unknown)',
            partition: fp.Partition ?? '(unknown)',
        }));
    }

    async listIdentities(eventStore: string, namespace: string): Promise<IdentityInfo[]> {
        const c = this._connection;
        if (!c) { return []; }
        type Item = { Subject?: string; Name?: string; UserName?: string };
        type Resp = { items?: Item[] };
        const call = c.identities.getIdentities.bind(c.identities) as GrpcUnaryMethod<object, Resp>;
        const resp = await grpcCall(call, { EventStore: eventStore, Namespace: namespace });
        return (resp?.items ?? []).map((i) => ({
            subject: i.Subject ?? '(unknown)',
            name: i.Name ?? '(unknown)',
            userName: i.UserName ?? '',
        }));
    }

    // ── Event-store level (General) ──────────────────────────────────────────

    async listEventTypes(eventStore: string): Promise<EventTypeInfo[]> {
        const c = this._connection;
        if (!c) { return []; }
        type Item = { Id?: string; Generation?: number };
        type Resp = { items?: Item[] };
        const call = c.eventTypes.getAll.bind(c.eventTypes) as GrpcUnaryMethod<object, Resp>;
        const resp = await grpcCall(call, { EventStore: eventStore });
        return (resp?.items ?? []).map((et) => ({
            id: et.Id ?? '(unknown)',
            generation: et.Generation ?? 1,
        }));
    }

    async listReadModelTypes(eventStore: string): Promise<ReadModelTypeInfo[]> {
        const c = this._connection;
        if (!c) { return []; }
        type Item = { Identifier?: string; DisplayName?: string };
        type Resp = { ReadModels?: Item[] };
        const call = c.readModels.getDefinitions.bind(c.readModels) as GrpcUnaryMethod<object, Resp>;
        const resp = await grpcCall(call, { EventStore: eventStore });
        return (resp?.ReadModels ?? []).map((rm) => ({
            identifier: rm.Identifier ?? '(unknown)',
            displayName: rm.DisplayName ?? rm.Identifier ?? '(unknown)',
        }));
    }

    async listProjections(eventStore: string): Promise<ProjectionInfo[]> {
        const c = this._connection;
        if (!c) { return []; }
        type Item = { Identifier?: string; ReadModel?: string };
        type Resp = { items?: Item[] };
        const call = c.projections.getAllDefinitions.bind(c.projections) as GrpcUnaryMethod<object, Resp>;
        const resp = await grpcCall(call, { EventStore: eventStore });
        return (resp?.items ?? []).map((p) => ({
            identifier: p.Identifier ?? '(unknown)',
            readModel: p.ReadModel ?? '',
        }));
    }
}
