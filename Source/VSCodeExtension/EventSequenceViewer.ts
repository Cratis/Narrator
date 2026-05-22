// Copyright (c) Cratis. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

import * as vscode from 'vscode';
import { AppendedEventInfo, ChronicleClientManager } from './ChronicleClientManager';

const PAGE_SIZE = 50;

interface OpenEventSequenceOptions {
    eventStore: string;
    namespace: string;
    sequenceId: string;
    sequenceName: string;
}

interface LoadPageMessage {
    type: 'loadPage';
    fromSequenceNumber: number;
}

type IncomingMessage = LoadPageMessage;

interface EventRow {
    sequenceNumber: number;
    eventType: string;
    eventSourceId: string;
    occurred?: string;
    context: Record<string, unknown>;
    content: Record<string, unknown> | string;
}

interface PageLoadedMessage {
    type: 'pageLoaded';
    fromSequenceNumber: number;
    pageSize: number;
    tail: number;
    events: EventRow[];
}

interface PageErrorMessage {
    type: 'pageError';
    fromSequenceNumber: number;
    message: string;
}

type OutgoingMessage = PageLoadedMessage | PageErrorMessage;

const openPanels = new Map<string, vscode.WebviewPanel>();

function panelKey(options: OpenEventSequenceOptions): string {
    return `${options.eventStore}::${options.namespace}::${options.sequenceId}`;
}

export function openEventSequenceViewer(
    getClientManager: () => ChronicleClientManager | undefined,
    options: OpenEventSequenceOptions
): void {
    const key = panelKey(options);
    const existing = openPanels.get(key);
    if (existing) {
        existing.reveal(vscode.ViewColumn.Active);
        return;
    }

    const panel = vscode.window.createWebviewPanel(
        'narrator.eventSequence',
        `${options.sequenceName} · ${options.namespace}`,
        vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true }
    );
    openPanels.set(key, panel);
    panel.webview.html = renderHtml({ sequenceName: options.sequenceName, namespace: options.namespace, eventStore: options.eventStore });

    panel.onDidDispose(() => {
        openPanels.delete(key);
    });

    panel.webview.onDidReceiveMessage(async (message: IncomingMessage) => {
        if (message.type !== 'loadPage') { return; }
        await loadPage(panel, getClientManager(), options, message.fromSequenceNumber);
    });

    void loadPage(panel, getClientManager(), options, 0);
}

async function loadPage(
    panel: vscode.WebviewPanel,
    manager: ChronicleClientManager | undefined,
    options: OpenEventSequenceOptions,
    fromSequenceNumber: number
): Promise<void> {
    if (!manager) {
        post(panel, {
            type: 'pageError',
            fromSequenceNumber,
            message: 'Not connected to a Chronicle context.',
        });
        return;
    }
    try {
        const tail = await manager.getEventSequenceTail(options.eventStore, options.namespace, options.sequenceId);
        const effectiveFrom = Math.max(0, fromSequenceNumber);
        const events = await manager.getEventsFromSequence(
            options.eventStore,
            options.namespace,
            options.sequenceId,
            effectiveFrom,
            effectiveFrom + PAGE_SIZE - 1,
        );
        post(panel, {
            type: 'pageLoaded',
            fromSequenceNumber: effectiveFrom,
            pageSize: PAGE_SIZE,
            tail,
            events: events.map(toRow),
        });
    } catch (error) {
        post(panel, {
            type: 'pageError',
            fromSequenceNumber,
            message: error instanceof Error ? error.message : String(error),
        });
    }
}

function post(panel: vscode.WebviewPanel, message: OutgoingMessage): void {
    void panel.webview.postMessage(message);
}

function toRow(event: AppendedEventInfo): EventRow {
    const context: Record<string, unknown> = {
        sequenceNumber: event.sequenceNumber,
        eventType: `${event.eventTypeId} (generation ${event.eventTypeGeneration})`,
        eventSourceType: event.eventSourceType || '(not set)',
        eventSourceId: event.eventSourceId || '(not set)',
        eventStreamType: event.eventStreamType || '(not set)',
        eventStreamId: event.eventStreamId || '(not set)',
        eventStore: event.eventStore,
        namespace: event.namespace,
        occurred: event.occurred ?? '(unknown)',
        correlationId: event.correlationId ?? '(none)',
        causedBy: formatCausedBy(event),
        observationState: String(event.observationState),
        tags: event.tags.length > 0 ? event.tags.join(', ') : '(none)',
        hash: event.hash || '(none)',
    };
    const content =
        event.content && typeof event.content === 'object' && !Array.isArray(event.content)
            ? (event.content as Record<string, unknown>)
            : event.contentRaw;
    return {
        sequenceNumber: event.sequenceNumber,
        eventType: event.eventTypeId,
        eventSourceId: event.eventSourceId,
        occurred: event.occurred,
        context,
        content,
    };
}

function formatCausedBy(event: AppendedEventInfo): string {
    const parts = [event.causedByName, event.causedByUserName, event.causedBySubject].filter(
        (part): part is string => typeof part === 'string' && part.length > 0
    );
    return parts.length > 0 ? Array.from(new Set(parts)).join(' · ') : '(none)';
}

function renderHtml(meta: { sequenceName: string; namespace: string; eventStore: string }): string {
    // The webview is fully self-contained — message protocol exchanges fetched pages
    // with the extension, so no external resource loading is needed.
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
<title>${escapeHtml(meta.sequenceName)}</title>
<style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 0; height: 100vh; display: flex; flex-direction: column; }
    header { padding: 8px 12px; border-bottom: 1px solid var(--vscode-panel-border); display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
    header h2 { margin: 0; font-size: 1.05em; font-weight: 600; }
    header .meta { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
    .pager { display: flex; align-items: center; gap: 8px; margin-left: auto; }
    button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 10px; cursor: pointer; font: inherit; }
    button:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .range { font-variant-numeric: tabular-nums; color: var(--vscode-descriptionForeground); }
    .split { display: flex; flex: 1; min-height: 0; }
    .events { flex: 1; overflow: auto; }
    .details { width: 40%; min-width: 280px; border-left: 1px solid var(--vscode-panel-border); display: flex; flex-direction: column; }
    table { width: 100%; border-collapse: collapse; font-size: 0.9em; }
    thead th { position: sticky; top: 0; background: var(--vscode-editorWidget-background); text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--vscode-panel-border); font-weight: 600; }
    tbody td { padding: 4px 10px; border-bottom: 1px solid var(--vscode-panel-border); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 320px; }
    tbody tr { cursor: pointer; }
    tbody tr:hover { background: var(--vscode-list-hoverBackground); }
    tbody tr.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
    tbody td.seq { font-variant-numeric: tabular-nums; color: var(--vscode-descriptionForeground); }
    .events:focus { outline: none; }
    .events:focus tbody tr.selected { background: var(--vscode-list-focusBackground, var(--vscode-list-activeSelectionBackground)); }
    .tabs { display: flex; border-bottom: 1px solid var(--vscode-panel-border); flex-shrink: 0; }
    .tab { padding: 6px 14px; cursor: pointer; border-right: 1px solid var(--vscode-panel-border); user-select: none; }
    .tab.active { background: var(--vscode-editor-background); font-weight: 600; border-bottom: 2px solid var(--vscode-focusBorder); }
    .tab-body { flex: 1; overflow: auto; padding: 8px 0; }
    .props { width: 100%; border-collapse: collapse; font-size: 0.9em; }
    .props th, .props td { text-align: left; vertical-align: top; padding: 4px 10px; border-bottom: 1px solid var(--vscode-panel-border); }
    .props th { width: 40%; font-weight: 600; color: var(--vscode-descriptionForeground); }
    .props td { word-break: break-word; font-variant-numeric: tabular-nums; }
    .empty { color: var(--vscode-descriptionForeground); padding: 16px; font-style: italic; }
    .error { color: var(--vscode-errorForeground); padding: 16px; }
    .raw { white-space: pre-wrap; padding: 8px 12px; font-family: var(--vscode-editor-font-family); font-size: 0.9em; }
</style>
</head>
<body>
<header>
    <div>
        <h2>${escapeHtml(meta.sequenceName)}</h2>
        <div class="meta">${escapeHtml(meta.eventStore)} · ${escapeHtml(meta.namespace)}</div>
    </div>
    <div class="pager">
        <button id="prev" type="button">Previous</button>
        <button id="next" type="button">Next</button>
        <span class="range" id="range"></span>
    </div>
</header>
<div class="split">
    <div class="events" id="events" tabindex="0">
        <table>
            <thead>
                <tr>
                    <th style="width: 80px;">Seq #</th>
                    <th style="width: 180px;">Occurred</th>
                    <th>Event Type</th>
                    <th>Event Source ID</th>
                </tr>
            </thead>
            <tbody id="rows"></tbody>
        </table>
        <div id="emptyState" class="empty">Loading…</div>
    </div>
    <aside class="details">
        <div class="tabs">
            <div class="tab active" data-tab="context">Context</div>
            <div class="tab" data-tab="content">Content</div>
        </div>
        <div class="tab-body" id="tabBody">
            <div class="empty">Select an event to view its details.</div>
        </div>
    </aside>
</div>
<script>
    const vscode = acquireVsCodeApi();
    const rowsEl = document.getElementById('rows');
    const emptyEl = document.getElementById('emptyState');
    const tabBodyEl = document.getElementById('tabBody');
    const rangeEl = document.getElementById('range');
    const prevBtn = document.getElementById('prev');
    const nextBtn = document.getElementById('next');
    const eventsEl = document.getElementById('events');
    const pageSize = ${PAGE_SIZE};

    let currentFrom = 0;
    let tail = 0;
    let events = [];
    let selectedIndex = -1;
    let activeTab = 'context';
    // After a paging load triggered by Arrow keys, we want the selection to land
    // on the edge the user was moving toward: 'last' when paging up via ArrowUp,
    // 'first' (default) when paging down via ArrowDown or via the buttons.
    let pendingSelection = 'first';

    prevBtn.addEventListener('click', () => {
        if (currentFrom <= 0) { return; }
        loadPage(Math.max(0, currentFrom - pageSize), 'first');
    });
    nextBtn.addEventListener('click', () => {
        const nextFrom = currentFrom + pageSize;
        if (nextFrom > tail) { return; }
        loadPage(nextFrom, 'first');
    });

    document.addEventListener('keydown', (event) => {
        if (event.defaultPrevented) { return; }
        // Don't hijack keys while the user is interacting with a focusable control
        // outside the events table (e.g. the Previous/Next buttons or a tab).
        const active = document.activeElement;
        if (active && active !== document.body && active !== eventsEl && !eventsEl.contains(active)) {
            return;
        }
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            moveSelection(1);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            moveSelection(-1);
        } else if (event.key === 'Home') {
            event.preventDefault();
            if (events.length > 0) {
                selectedIndex = 0;
                renderRows();
                renderDetails();
                scrollSelectedIntoView();
            }
        } else if (event.key === 'End') {
            event.preventDefault();
            if (events.length > 0) {
                selectedIndex = events.length - 1;
                renderRows();
                renderDetails();
                scrollSelectedIntoView();
            }
        } else if (event.key === 'PageDown') {
            event.preventDefault();
            const nextFrom = currentFrom + pageSize;
            if (nextFrom <= tail) { loadPage(nextFrom, 'first'); }
        } else if (event.key === 'PageUp') {
            event.preventDefault();
            if (currentFrom > 0) { loadPage(Math.max(0, currentFrom - pageSize), 'first'); }
        }
    });

    function moveSelection(delta) {
        if (events.length === 0) { return; }
        const target = selectedIndex + delta;
        if (target >= 0 && target < events.length) {
            selectedIndex = target;
            renderRows();
            renderDetails();
            scrollSelectedIntoView();
            return;
        }
        // Spill across page boundaries — load the adjacent page and put the
        // selection at the edge the user was moving toward.
        if (delta > 0 && currentFrom + pageSize <= tail) {
            loadPage(currentFrom + pageSize, 'first');
        } else if (delta < 0 && currentFrom > 0) {
            loadPage(Math.max(0, currentFrom - pageSize), 'last');
        }
    }

    function scrollSelectedIntoView() {
        const row = rowsEl.children[selectedIndex];
        if (row && typeof row.scrollIntoView === 'function') {
            row.scrollIntoView({ block: 'nearest' });
        }
    }

    document.querySelectorAll('.tab').forEach((tab) => {
        tab.addEventListener('click', () => {
            activeTab = tab.getAttribute('data-tab') || 'context';
            for (const other of document.querySelectorAll('.tab')) {
                other.classList.toggle('active', other === tab);
            }
            renderDetails();
        });
    });

    function loadPage(fromSequenceNumber, selectAfterLoad) {
        pendingSelection = selectAfterLoad || 'first';
        emptyEl.textContent = 'Loading…';
        emptyEl.style.display = 'block';
        rowsEl.innerHTML = '';
        vscode.postMessage({ type: 'loadPage', fromSequenceNumber });
    }

    window.addEventListener('message', (event) => {
        const message = event.data;
        if (message.type === 'pageLoaded') {
            handlePageLoaded(message);
        } else if (message.type === 'pageError') {
            handlePageError(message);
        }
    });

    function handlePageLoaded(message) {
        currentFrom = message.fromSequenceNumber;
        tail = message.tail;
        events = message.events;
        if (events.length === 0) {
            selectedIndex = -1;
        } else if (pendingSelection === 'last') {
            selectedIndex = events.length - 1;
        } else {
            selectedIndex = 0;
        }
        pendingSelection = 'first';
        renderRows();
        renderDetails();
        renderPager();
        eventsEl.focus();
        scrollSelectedIntoView();
    }

    function handlePageError(message) {
        events = [];
        selectedIndex = -1;
        rowsEl.innerHTML = '';
        emptyEl.innerHTML = '';
        const errorEl = document.createElement('div');
        errorEl.className = 'error';
        errorEl.textContent = 'Failed to load events: ' + message.message;
        emptyEl.appendChild(errorEl);
        emptyEl.style.display = 'block';
        renderDetails();
        renderPager();
    }

    function renderRows() {
        rowsEl.innerHTML = '';
        if (events.length === 0) {
            emptyEl.textContent = 'No events in this range.';
            emptyEl.style.display = 'block';
            return;
        }
        emptyEl.style.display = 'none';
        for (let index = 0; index < events.length; index++) {
            const row = events[index];
            const tr = document.createElement('tr');
            if (index === selectedIndex) { tr.classList.add('selected'); }
            tr.addEventListener('click', () => {
                selectedIndex = index;
                renderRows();
                renderDetails();
                eventsEl.focus();
            });
            tr.appendChild(cell(String(row.sequenceNumber), 'seq'));
            tr.appendChild(cell(row.occurred || '(unknown)'));
            tr.appendChild(cell(row.eventType));
            tr.appendChild(cell(row.eventSourceId || '(not set)'));
            rowsEl.appendChild(tr);
        }
    }

    function cell(text, className) {
        const td = document.createElement('td');
        if (className) { td.className = className; }
        td.textContent = text;
        td.title = text;
        return td;
    }

    function renderDetails() {
        tabBodyEl.innerHTML = '';
        if (selectedIndex < 0 || selectedIndex >= events.length) {
            const empty = document.createElement('div');
            empty.className = 'empty';
            empty.textContent = 'Select an event to view its details.';
            tabBodyEl.appendChild(empty);
            return;
        }
        const event = events[selectedIndex];
        if (activeTab === 'context') {
            tabBodyEl.appendChild(buildPropertyTable(event.context));
        } else {
            if (typeof event.content === 'string') {
                if (event.content.length === 0) {
                    const empty = document.createElement('div');
                    empty.className = 'empty';
                    empty.textContent = '(empty)';
                    tabBodyEl.appendChild(empty);
                } else {
                    const pre = document.createElement('div');
                    pre.className = 'raw';
                    pre.textContent = event.content;
                    tabBodyEl.appendChild(pre);
                }
            } else {
                tabBodyEl.appendChild(buildPropertyTable(event.content));
            }
        }
    }

    function buildPropertyTable(data) {
        const entries = Object.entries(data || {});
        if (entries.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'empty';
            empty.textContent = '(no properties)';
            return empty;
        }
        const table = document.createElement('table');
        table.className = 'props';
        for (const [key, value] of entries) {
            const tr = document.createElement('tr');
            const th = document.createElement('th');
            th.textContent = formatKey(key);
            const td = document.createElement('td');
            td.textContent = formatValue(value);
            tr.appendChild(th);
            tr.appendChild(td);
            table.appendChild(tr);
        }
        return table;
    }

    function formatKey(key) {
        if (!key) { return key; }
        const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
        return spaced.charAt(0).toUpperCase() + spaced.slice(1);
    }

    function formatValue(value) {
        if (value === null || value === undefined) { return 'null'; }
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            return String(value);
        }
        try { return JSON.stringify(value); } catch { return String(value); }
    }

    function renderPager() {
        const hasEvents = events.length > 0;
        const last = hasEvents ? events[events.length - 1].sequenceNumber : currentFrom - 1;
        const first = hasEvents ? events[0].sequenceNumber : currentFrom;
        if (tail <= 0) {
            rangeEl.textContent = 'No events yet';
        } else if (hasEvents) {
            rangeEl.textContent = first + '–' + last + ' of ' + tail;
        } else {
            rangeEl.textContent = 'Tail at ' + tail;
        }
        prevBtn.disabled = currentFrom <= 0;
        nextBtn.disabled = currentFrom + pageSize > tail;
    }
</script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (match) => {
        switch (match) {
            case '&': return '&amp;';
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '"': return '&quot;';
            case '\'': return '&#39;';
            default: return match;
        }
    });
}
