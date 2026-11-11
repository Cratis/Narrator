// Copyright (c) Cratis. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

import * as vscode from 'vscode';
import { ChronicleTreeItem } from './providers/ChronicleTreeDataProvider';
import { ChronicleClientManager } from './ChronicleClientManager';
import { openEventSequenceViewer } from './EventSequenceViewer';

/**
 * Registers commands that open Chronicle artifact source — event-type and read-model JSON
 * schemas, projection DSL declarations — in throwaway editor tabs so the user can read or
 * copy the full text.
 */
export function registerEditorCommands(
    getClientManager: () => ChronicleClientManager | undefined
): vscode.Disposable[] {
    return [
        vscode.commands.registerCommand('narrator.openEventTypeSchema', openEventTypeSchema),
        vscode.commands.registerCommand('narrator.openReadModelSchema', openReadModelSchema),
        vscode.commands.registerCommand('narrator.openProjectionDeclaration', openProjectionDeclaration),
        vscode.commands.registerCommand('narrator.openEventSequence', (item?: ChronicleTreeItem) => openEventSequence(getClientManager, item)),
    ];
}

interface SchemaData {
    schemaRaw?: string;
    schema?: unknown;
}

interface EventTypeData extends SchemaData {
    id?: string;
}

interface ReadModelData extends SchemaData {
    displayName?: string;
    identifier?: string;
}

function openEventTypeSchema(item?: ChronicleTreeItem): void {
    const data = item?.details?.data as EventTypeData | undefined;
    if (!data) { return; }
    openSchema(`Event Type Schema: ${data.id ?? 'unknown'}`, data);
}

function openReadModelSchema(item?: ChronicleTreeItem): void {
    const data = item?.details?.data as ReadModelData | undefined;
    if (!data) { return; }
    openSchema(`Read Model Schema: ${data.displayName ?? data.identifier ?? 'unknown'}`, data);
}

function openSchema(title: string, data: SchemaData): void {
    openContent({
        title,
        rawText: data.schemaRaw,
        parsed: data.schema,
        language: 'json',
    });
}

function openProjectionDeclaration(item?: ChronicleTreeItem): void {
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
}

type EventSequenceTarget = Parameters<typeof openEventSequenceViewer>[1];

function toEventSequenceTarget(item?: ChronicleTreeItem): EventSequenceTarget | undefined {
    const data = item?.details?.data as { id?: string; name?: string } | undefined;
    if (!item || !data?.id) { return undefined; }
    const { eventStoreName: eventStore, namespaceName: namespace } = item;
    if (!eventStore || !namespace) { return undefined; }
    return { eventStore, namespace, sequenceId: data.id, sequenceName: data.name ?? data.id };
}

function openEventSequence(getClientManager: () => ChronicleClientManager | undefined, item?: ChronicleTreeItem): void {
    const target = toEventSequenceTarget(item);
    if (!target) {
        vscode.window.showWarningMessage('Cannot open event sequence — missing context.');
        return;
    }
    openEventSequenceViewer(getClientManager, target);
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
