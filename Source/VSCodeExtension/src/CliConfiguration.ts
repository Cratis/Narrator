import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface CliContext {
    server?: string;
    eventStore?: string;
    namespace?: string;
    clientId?: string;
    clientSecret?: string;
    managementPort?: number;
    accessToken?: string;
    tokenExpiry?: string;
    loggedInUser?: string;
}

export interface CliConfiguration {
    activeContext?: string;
    contexts: Record<string, CliContext>;
}

export function getConfigPath(): string {
    return path.join(os.homedir(), '.cratis', 'config.json');
}

export function loadCliConfiguration(configPath?: string): CliConfiguration {
    const filePath = configPath ?? getConfigPath();
    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(raw) as CliConfiguration;
    } catch {
        return { contexts: {} };
    }
}

export function saveCliConfiguration(config: CliConfiguration, configPath?: string): void {
    const filePath = configPath ?? getConfigPath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
}
