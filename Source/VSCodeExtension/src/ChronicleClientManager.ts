import { CliContext } from './CliConfiguration';

type ChronicleConnectionType = InstanceType<typeof import('@cratis/chronicle.contracts').ChronicleConnection>;

function buildConnectionString(context: CliContext): string {
    if (!context.server) {
        throw new Error('No server configured in the active context');
    }

    // Parse the server URL to inject credentials if needed
    const serverUrl = new URL(context.server);
    if (context.clientId && context.clientSecret) {
        serverUrl.username = encodeURIComponent(context.clientId);
        serverUrl.password = encodeURIComponent(context.clientSecret);
    }
    return serverUrl.toString();
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

    async listEventStores(): Promise<string[]> {
        const connection = this._connection;
        if (!connection) {
            return [];
        }
        return new Promise<string[]>((resolve, reject) => {
            connection.eventStores.getEventStores({}, (err: Error | null, response: { items?: string[] } | undefined) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(response?.items ?? []);
                }
            });
        });
    }

    async listNamespaces(eventStoreName: string): Promise<string[]> {
        const connection = this._connection;
        if (!connection) {
            return [];
        }
        return new Promise<string[]>((resolve, reject) => {
            connection.namespaces.getNamespaces({ EventStore: eventStoreName }, (err: Error | null, response: { items?: string[] } | undefined) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(response?.items ?? []);
                }
            });
        });
    }

    async listObservers(eventStoreName: string, namespace: string): Promise<string[]> {
        const connection = this._connection;
        if (!connection) {
            return [];
        }
        return new Promise<string[]>((resolve, reject) => {
            connection.observers.getObservers({ EventStore: eventStoreName, Namespace: namespace }, (err: Error | null, response: { items?: Array<{ Id?: string }> } | undefined) => {
                if (err) {
                    reject(err);
                } else {
                    const observers = response?.items ?? [];
                    resolve(observers.map((o) => o.Id ?? '(unknown)'));
                }
            });
        });
    }
}
