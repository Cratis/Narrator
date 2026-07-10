// Copyright (c) Cratis. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface Context {
    server?: string;
    eventStore?: string;
    namespace?: string;
    clientId?: string;
    clientSecret?: string;
    accessToken?: string;
    tokenExpiry?: string;
    loggedInUser?: string;
}

export interface Configuration {
    activeContext?: string;
    contexts: Record<string, Context>;
}

export function getConfigPath(): string {
    return path.join(os.homedir(), '.cratis', 'config.json');
}

export function loadConfiguration(configPath?: string): Configuration {
    const filePath = configPath ?? getConfigPath();
    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(raw) as Configuration;
    } catch {
        return { contexts: {} };
    }
}

export function saveConfiguration(config: Configuration, configPath?: string): void {
    const filePath = configPath ?? getConfigPath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
}
