// Copyright (c) Cratis. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

import * as vscode from 'vscode';
import { ChronicleTreeItem } from './providers/ChronicleTreeDataProvider';

/**
 * Registers commands that open Chronicle artifact source — event-type and read-model JSON
 * schemas, projection DSL declarations — in throwaway editor tabs so the user can read or
 * copy the full text.
 */
export function registerEditorCommands(): vscode.Disposable[] {
    return [
        vscode.commands.registerCommand('narrator.openEventTypeSchema', (item?: ChronicleTreeItem) => {
            const data = item?.details?.data as { id?: string; schemaRaw?: string; schema?: unknown } | undefined;
            if (!data) { return; }
            openContent({
                title: `Event Type Schema: ${data.id ?? 'unknown'}`,
                rawText: data.schemaRaw,
                parsed: data.schema,
                language: 'json',
            });
        }),
        vscode.commands.registerCommand('narrator.openReadModelSchema', (item?: ChronicleTreeItem) => {
            const data = item?.details?.data as { displayName?: string; identifier?: string; schemaRaw?: string; schema?: unknown } | undefined;
            if (!data) { return; }
            openContent({
                title: `Read Model Schema: ${data.displayName ?? data.identifier ?? 'unknown'}`,
                rawText: data.schemaRaw,
                parsed: data.schema,
                language: 'json',
            });
        }),
        vscode.commands.registerCommand('narrator.openProjectionDeclaration', (item?: ChronicleTreeItem) => {
            const data = item?.details?.data as { identifier?: string; declaration?: string } | undefined;
            if (!data) { return; }
            if (!data.declaration) {
                vscode.window.showInformationMessage(`Projection '${data.identifier ?? 'unknown'}' has no declarative source — it was registered model-bound.`);
                return;
            }
            openContent({
                title: `Projection Declaration: ${data.identifier ?? 'unknown'}`,
                rawText: data.declaration,
                language: 'plaintext',
            });
        }),
    ];
}

interface OpenContentOptions {
    title: string;
    rawText?: string;
    parsed?: unknown;
    language: string;
}

async function openContent({ title, rawText, parsed, language }: OpenContentOptions): Promise<void> {
    const content = formatContent(rawText, parsed);
    if (!content) {
        vscode.window.showInformationMessage(`${title} is empty.`);
        return;
    }
    const document = await vscode.workspace.openTextDocument({ content, language });
    await vscode.window.showTextDocument(document, { preview: true });
    // Title isn't a property of untitled documents, but showing it via a status bar message
    // gives the user immediate context for what they're looking at.
    vscode.window.setStatusBarMessage(title, 5000);
}

function formatContent(rawText: string | undefined, parsed: unknown): string {
    if (parsed !== undefined && parsed !== null) {
        try {
            return JSON.stringify(parsed, null, 2);
        } catch {
            // Fall through to raw text
        }
    }
    return rawText ?? '';
}
