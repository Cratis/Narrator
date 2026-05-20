// Copyright (c) Cratis. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

import * as vscode from 'vscode';

/**
 * Updates the status bar item to reflect the current Chronicle connection state.
 */
export function updateStatusBar(
    item: vscode.StatusBarItem,
    contextName: string | undefined,
    connected: boolean,
    connecting = false
): void {
    const name = contextName ?? 'default';
    if (connecting) {
        item.text = `$(plug~spin) Chronicle: Connecting...`;
        item.tooltip = `Connecting to Chronicle (${name})`;
    } else if (connected) {
        item.text = `$(plug) Chronicle: ${name}`;
        item.tooltip = `Connected to Chronicle (${name})`;
    } else {
        item.text = `$(debug-disconnect) Chronicle: ${name}`;
        item.tooltip = `Not connected to Chronicle (${name}) — click to switch context`;
    }
}
