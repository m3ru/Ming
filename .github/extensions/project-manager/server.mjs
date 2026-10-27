// server.mjs — loopback HTTP server that renders Ming's Kanban board and its
// dependency graph, and exposes the JSON endpoints the page uses. Every server
// reads/writes the same board.json, so all open panels stay in sync over SSE.

import { createServer } from "node:http";
import {
    getBoard,
    withStatus,
    addComponent,
    removeComponent,
    renameComponent,
    addTask,
    toggleTask,
    removeTask,
    setTaskOwner,
    setTaskAgent,
    setTaskDependencies,
    moveTask,
    moveTaskStep,
    OWNERS,
    events,
    watchBoard,
} from "./board.mjs";

function json(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(payload),
        "Cache-Control": "no-store",
    });
    res.end(payload);
}

async function readJsonBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (chunks.length === 0) return {};
    try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
        return {};
    }
}

export async function startServer() {
    await getBoard();
    const sseClients = new Set();

    const onChanged = (board) => {
        const payload = `data: ${JSON.stringify(withStatus(board))}\n\n`;
        for (const res of sseClients) res.write(payload);
    };
    events.on("changed", onChanged);

    const server = createServer(async (req, res) => {
        try {
            const url = new URL(req.url, "http://127.0.0.1");
            const [, api, kind, id, verb] = url.pathname.split("/");

            if (req.method === "GET" && url.pathname === "/") {
                res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
                res.end(renderHtml());
                return;
            }
            if (req.method === "GET" && url.pathname === "/api/meta") return json(res, 200, { owners: OWNERS });
            if (req.method === "GET" && url.pathname === "/api/board") return json(res, 200, withStatus(await getBoard()));
            if (req.method === "GET" && url.pathname === "/events") {
                res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
                res.write(`data: ${JSON.stringify(withStatus(await getBoard()))}\n\n`);
                sseClients.add(res);
                req.on("close", () => sseClients.delete(res));
                return;
            }
            if (api !== "api") return json(res, 404, { error: "not_found" });

            const body = req.method === "POST" ? await readJsonBody(req) : {};
            if (kind === "component") {
                if (req.method === "POST" && !id) return json(res, 200, await addComponent(body.name));
                if (req.method === "POST" && verb === "rename") {
                    await renameComponent(id, body.name);
                    return json(res, 200, { ok: true });
                }
                if (req.method === "DELETE" && id) {
                    await removeComponent(id);
                    return json(res, 200, { ok: true });
                }
            }
            if (kind === "task") {
                if (req.method === "POST" && !id) return json(res, 200, await addTask(body.componentId, body.title, body.owner));
                if (req.method === "DELETE" && id && !verb) {
                    await removeTask(id);
                    return json(res, 200, { ok: true });
                }
                if (req.method === "POST") {
                    if (verb === "toggle") return json(res, 200, await toggleTask(id, body.done));
                    if (verb === "owner") return json(res, 200, await setTaskOwner(id, body.owner));
                    if (verb === "agent") return json(res, 200, await setTaskAgent(id, body.agent));
                    if (verb === "depends") return json(res, 200, await setTaskDependencies(id, body.dependsOn));
                    if (verb === "move") return json(res, 200, await moveTask(id, body.componentId, body.index));
                    if (verb === "step") return json(res, 200, await moveTaskStep(id, body.direction));
                }
            }
            json(res, 404, { error: "not_found" });
        } catch (err) {
            json(res, 400, { error: String(err && err.message ? err.message : err) });
        }
    });

    try {
        await new Promise((resolve, reject) => {
            server.once("error", reject);
            // A fixed port gives the team a stable address; by default any free port is used.
            server.listen(Number(process.env.PROJECT_MANAGER_PORT) || 0, "127.0.0.1", resolve);
        });
    } catch (err) {
        events.off("changed", onChanged);
        throw err;
    }
    const stopWatching = watchBoard();
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const close = async () => {
        events.off("changed", onChanged);
        await stopWatching();
        for (const res of sseClients) res.end();
        await new Promise((resolve) => server.close(() => resolve()));
    };

    return { url: `http://127.0.0.1:${port}/`, close };
}

function renderHtml() {
    const ownerStyles = OWNERS.map((owner) =>
        `[data-owner="${owner.id}"] { --owner: ${owner.color}; --owner-tint: ${owner.tint}; }`,
    ).join("\n");
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Ming · Project Board</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Caveat:wght@500;700&family=Schibsted+Grotesk:wght@400;600;700;800&display=swap" rel="stylesheet" />
<style>
  /* Ming's "Director's notes" palette (src/app/globals.css). */
  :root {
    color-scheme: light;
    --paper: #f2f3ef; --ink: #2e3135; --ink-soft: #5e636a; --rule: #dadcd4;
    --highlight: #ffe55c; --pencil: #3557c8; --red-pencil: #c43d3d; --sage: #2e7d69;
    --card: #ffffff;
    --sans: "Schibsted Grotesk", ui-sans-serif, system-ui, sans-serif;
    --hand: "Caveat", "Bradley Hand", cursive;
  }
  ${ownerStyles}
  * { box-sizing: border-box; }
  /* Views set their own display, which would otherwise override the hidden attribute. */
  [hidden] { display: none !important; }
  body { margin: 0; background: var(--paper); color: var(--ink); font-family: var(--sans); font-size: 14px; line-height: 1.45; }
  button, select, input { font: inherit; color: inherit; }
  :focus-visible { outline: 2px solid var(--pencil); outline-offset: 2px; }
  .hand { font-family: var(--hand); }
  .swipe { position: relative; isolation: isolate; }
  .swipe::before {
    content: ""; position: absolute; z-index: -1; inset: 0.45em -0.14em 0.04em -0.2em;
    background: var(--highlight); border-radius: 0.35em 0.6em 0.3em 0.65em; transform: rotate(-1.2deg);
  }

  header {
    display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 16px 24px;
    padding: 24px 28px 14px; border-bottom: 1px dashed var(--rule);
  }
  .eyebrow { margin: 0 0 2px; font-size: 22px; color: var(--ink-soft); transform: rotate(-1deg); }
  h1 { margin: 0; font-size: 30px; font-weight: 800; letter-spacing: -0.02em; line-height: 1.1; }
  .header-right { display: flex; flex-wrap: wrap; align-items: center; gap: 18px; }
  .progress { min-width: 260px; }
  .progress-bar { height: 8px; border-radius: 99px; background: var(--rule); overflow: hidden; display: flex; }
  .progress-bar span { display: block; height: 100%; transition: width 400ms ease; }
  .progress-bar .done { background: var(--sage); }
  .progress-bar .ready { background: var(--pencil); opacity: 0.55; }
  .progress-text { margin-top: 6px; font-size: 12px; color: var(--ink-soft); display: flex; gap: 12px; }
  .progress-text b { color: var(--ink); }
  .tabs { display: inline-flex; padding: 3px; border-radius: 999px; background: var(--card); border: 1px solid var(--rule); }
  .tabs button {
    border: 0; background: none; padding: 7px 16px; border-radius: 999px; font-weight: 600; cursor: pointer; color: var(--ink-soft);
    transition: background 150ms ease, color 150ms ease;
  }
  .tabs button[aria-selected="true"] { background: var(--ink); color: var(--paper); }

  .owner-legend { display: flex; flex-wrap: wrap; gap: 10px; padding: 14px 28px 0; align-items: stretch; }
  .owner-key {
    display: flex; flex-direction: column; gap: 1px; text-align: left; cursor: pointer;
    padding: 7px 14px 6px; border-radius: 14px; border: 1px solid transparent; background: var(--owner-tint);
    transition: opacity 150ms ease, border-color 150ms ease, transform 150ms ease;
  }
  .owner-key:hover { transform: translateY(-1px); }
  .owner-key[aria-pressed="true"] { border-color: var(--owner); }
  .owner-key.faded { opacity: 0.4; }
  .owner-key strong { display: flex; align-items: center; gap: 7px; color: var(--owner); font-size: 13px; }
  .owner-key strong::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--owner); }
  .owner-key .hand { font-size: 17px; line-height: 1.1; color: var(--ink-soft); }
  #board-status { margin: 10px 28px 0; min-height: 18px; font-size: 12px; color: var(--ink-soft); }
  #board-status.error { color: var(--red-pencil); }

  /* Board view */
  #board-main { display: flex; align-items: flex-start; gap: 16px; overflow-x: auto; padding: 14px 28px 48px; min-height: 70vh; }
  .column {
    flex: 0 0 290px; width: 290px; background: color-mix(in srgb, var(--card) 55%, transparent);
    border: 1px solid var(--rule); border-radius: 16px; display: flex; flex-direction: column;
  }
  .column.drag-over { outline: 2px dashed var(--pencil); outline-offset: -3px; }
  .column-header { display: flex; align-items: center; gap: 6px; padding: 12px 14px 0; }
  .column-header input { flex: 1; min-width: 0; border: 0; background: none; font-weight: 800; font-size: 15px; letter-spacing: -0.01em; }
  .column-desc { margin: 2px 14px 0; font-size: 12px; color: var(--ink-soft); }
  .column-count { margin: 4px 14px 8px; font-family: var(--hand); font-size: 17px; color: var(--ink-soft); }
  .icon-btn { border: 0; background: none; cursor: pointer; color: var(--ink-soft); padding: 2px 5px; border-radius: 6px; }
  .icon-btn:hover { background: var(--rule); color: var(--ink); }
  .stack { display: flex; flex-direction: column; padding: 0 10px; min-height: 40px; }
  .drop-slot { flex: 0 0 8px; border-radius: 4px; }
  .drop-slot.active { background: color-mix(in srgb, var(--pencil) 25%, transparent); }

  .card {
    position: relative; background: var(--card); border: 1px solid var(--rule); border-radius: 12px;
    padding: 10px 10px 9px 15px; display: flex; flex-direction: column; gap: 8px; cursor: grab;
    box-shadow: 0 1px 0 rgba(46, 49, 53, 0.04);
    transition: opacity 150ms ease, box-shadow 150ms ease, transform 150ms ease;
  }
  .card:hover { box-shadow: 0 6px 18px -10px rgba(46, 49, 53, 0.35); transform: translateY(-1px); }
  .card::before { content: ""; position: absolute; left: 0; top: 8px; bottom: 8px; width: 4px; border-radius: 0 4px 4px 0; background: var(--owner); }
  .card.dragging { opacity: 0.4; }
  .card.faded { opacity: 0.3; }
  .card[data-status="blocked"] { background: repeating-linear-gradient(135deg, var(--card), var(--card) 9px, #fbf6f5 9px, #fbf6f5 18px); }
  .card-top { display: flex; align-items: flex-start; gap: 8px; }
  .card-top input[type="checkbox"] { margin-top: 3px; accent-color: var(--sage); width: 15px; height: 15px; }
  .card-title { flex: 1; font-weight: 600; word-break: break-word; }
  .card[data-status="done"] .card-title { text-decoration: line-through; text-decoration-color: var(--sage); color: var(--ink-soft); }
  .pill { display: inline-flex; align-items: center; gap: 5px; padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; white-space: nowrap; }
  .pill.done { background: #e2f0eb; color: var(--sage); }
  .pill.ready { background: #e6ebfa; color: var(--pencil); }
  .pill.blocked { background: #f8e6e6; color: var(--red-pencil); }
  .pill.ready::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--pencil); animation: pulse 1.6s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: 0.25; } }
  .card-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  select.owner-select {
    padding: 2px 8px; border-radius: 999px; border: 1px solid var(--owner); background: var(--owner-tint);
    color: var(--owner); font-weight: 700; font-size: 12px;
  }
  select.agent-select { border: 0; border-bottom: 1px dashed var(--rule); background: none; font-family: var(--hand); font-size: 17px; color: var(--owner); padding: 0 2px; max-width: 170px; }
  .deps { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; font-size: 12px; }
  .deps-label { font-family: var(--hand); font-size: 16px; color: var(--ink-soft); }
  .dep-chip {
    display: inline-flex; align-items: center; gap: 4px; max-width: 100%; padding: 1px 4px 1px 7px; border-radius: 999px;
    background: var(--owner-tint); color: var(--ink); border: 1px solid transparent;
  }
  .dep-chip.open { border-color: color-mix(in srgb, var(--red-pencil) 45%, transparent); }
  .dep-chip.done span { text-decoration: line-through; color: var(--ink-soft); }
  .dep-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 170px; }
  .dep-chip::before { content: ""; flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--owner); }
  .dep-chip button { border: 0; background: none; cursor: pointer; color: var(--ink-soft); padding: 0 3px; }
  select.dep-add { font-size: 12px; border: 1px dashed var(--rule); border-radius: 999px; background: none; color: var(--ink-soft); padding: 1px 6px; max-width: 140px; }
  .card-bottom { display: flex; align-items: center; gap: 6px; }
  select.move-select { flex: 1; min-width: 0; font-size: 12px; border: 1px solid var(--rule); border-radius: 8px; background: var(--card); padding: 3px 5px; color: var(--ink-soft); }
  form.add-task { display: flex; gap: 6px; padding: 10px; border-top: 1px dashed var(--rule); margin-top: 8px; }
  form.add-task input { flex: 1; min-width: 0; border: 1px solid var(--rule); border-radius: 8px; padding: 5px 8px; background: var(--card); }
  form.add-task select { border: 1px solid var(--rule); border-radius: 8px; background: var(--card); font-size: 12px; }
  .btn { border: 1px solid var(--rule); background: var(--card); border-radius: 8px; padding: 5px 10px; cursor: pointer; font-weight: 600; }
  .btn.primary { background: var(--pencil); border-color: var(--pencil); color: #fff; }
  .add-column {
    flex: 0 0 200px; min-height: 90px; border: 1px dashed var(--rule); border-radius: 16px; background: none;
    font-family: var(--hand); font-size: 20px; color: var(--ink-soft); cursor: pointer;
  }

  /* Graph view */
  #graph-view { padding: 10px 28px 48px; }
  .graph-key { display: flex; flex-wrap: wrap; gap: 18px; align-items: center; margin: 4px 0 10px; font-size: 12px; color: var(--ink-soft); }
  .graph-key i { display: inline-block; vertical-align: middle; margin-right: 6px; }
  .key-critical { width: 26px; height: 9px; border-radius: 6px; background: var(--highlight); }
  .key-done { width: 26px; height: 2px; background: var(--sage); }
  .key-wait { width: 26px; border-top: 2px dashed var(--red-pencil); }
  .key-ready { width: 9px; height: 9px; border-radius: 50%; background: var(--pencil); }
  .graph-wrap { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 16px; align-items: start; }
  .graph-scroll { overflow: auto; border: 1px solid var(--rule); border-radius: 18px; background: var(--card); }
  #graph { display: block; }
  #graph .rank-label { font-family: var(--hand); font-size: 20px; fill: var(--ink-soft); }
  #graph .rank-rule { stroke: var(--rule); stroke-dasharray: 3 6; }
  #graph .edge { fill: none; stroke-width: 1.8; transition: opacity 150ms ease; }
  #graph .edge.done { stroke: var(--sage); opacity: 0.55; }
  #graph .edge.waiting { stroke: var(--red-pencil); stroke-dasharray: 6 5; animation: flow 1.1s linear infinite; }
  @keyframes flow { to { stroke-dashoffset: -22; } }
  #graph .critical-ink { fill: none; stroke: var(--highlight); stroke-width: 12; stroke-linecap: round; opacity: 0.9; }
  #graph .node { cursor: pointer; transition: opacity 150ms ease; }
  #graph .node-card { fill: var(--card); stroke: var(--rule); stroke-width: 1; transition: stroke 150ms ease; }
  #graph .node:hover .node-card, #graph .node.pinned .node-card { stroke: var(--owner); stroke-width: 2; }
  #graph .node-halo { fill: var(--highlight); opacity: 0.85; }
  #graph .node-stripe { fill: var(--owner); }
  #graph .node-title { font-size: 13px; font-weight: 700; fill: var(--ink); }
  #graph .node.done .node-title { fill: var(--ink-soft); text-decoration: line-through; }
  #graph .node-owner { font-size: 11px; font-weight: 800; fill: var(--owner); letter-spacing: 0.04em; text-transform: uppercase; }
  #graph .node-agent { font-family: var(--hand); font-size: 16px; fill: var(--ink-soft); }
  #graph .badge-done { fill: var(--sage); }
  #graph .badge-ready { fill: var(--card); stroke: var(--pencil); stroke-width: 2; }
  #graph .badge-ready-dot { fill: var(--pencil); animation: pulse 1.6s ease-in-out infinite; }
  #graph .badge-blocked { fill: #f8e6e6; stroke: var(--red-pencil); stroke-width: 1.5; stroke-dasharray: 3 2; }
  #graph .badge-glyph { font-size: 11px; font-weight: 800; text-anchor: middle; }
  #graph .dim { opacity: 0.14; }
  #graph .lit.edge { opacity: 1; stroke-width: 2.6; }
  .detail { position: sticky; top: 16px; background: var(--card); border: 1px solid var(--rule); border-radius: 18px; padding: 16px 18px; }
  .detail h2 { margin: 6px 0 8px; font-size: 18px; line-height: 1.25; letter-spacing: -0.01em; }
  .detail .who { display: flex; align-items: baseline; gap: 8px; color: var(--owner); font-weight: 800; }
  .detail .who .hand { font-size: 19px; font-weight: 500; }
  .detail h3 { margin: 14px 0 6px; font-family: var(--hand); font-weight: 500; font-size: 20px; color: var(--ink-soft); }
  .detail ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  .detail li { display: flex; align-items: center; gap: 8px; font-size: 13px; }
  .detail li::before { content: ""; flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--owner); }
  .detail .empty { color: var(--ink-soft); font-size: 13px; }
  .detail .hint { font-family: var(--hand); font-size: 20px; color: var(--ink-soft); line-height: 1.2; }
  .detail .btn { margin-top: 16px; width: 100%; }
  @media (max-width: 900px) { .graph-wrap { grid-template-columns: 1fr; } .detail { position: static; } }
  @media (prefers-reduced-motion: reduce) { *, *::before { animation: none !important; transition: none !important; } }
</style>
</head>
<body>
<header>
  <div>
    <p class="eyebrow hand">who's waiting on whom</p>
    <h1><span class="swipe" id="board-title">Ming</span></h1>
  </div>
  <div class="header-right">
    <div class="progress" aria-live="polite">
      <div class="progress-bar"><span class="done" id="bar-done"></span><span class="ready" id="bar-ready"></span></div>
      <div class="progress-text" id="progress-text"></div>
    </div>
    <div class="tabs" role="tablist" aria-label="View">
      <button type="button" role="tab" id="tab-board" aria-selected="true" aria-controls="board-main">Board</button>
      <button type="button" role="tab" id="tab-graph" aria-selected="false" aria-controls="graph-view">Graph</button>
    </div>
  </div>
</header>
<div id="owner-legend" class="owner-legend" aria-label="Owners and their agents. Select one to focus on their work."></div>
<p id="board-status" role="status" aria-live="polite">Loading board…</p>
<main id="board-main" role="tabpanel" aria-labelledby="tab-board"></main>
<section id="graph-view" role="tabpanel" aria-labelledby="tab-graph" hidden>
  <div class="graph-key">
    <span><i class="key-critical"></i>critical path: the longest chain of open work</span>
    <span><i class="key-wait"></i>still waiting</span>
    <span><i class="key-done"></i>dependency done</span>
    <span><i class="key-ready"></i>ready to start</span>
  </div>
  <div class="graph-wrap">
    <div class="graph-scroll"><svg id="graph" role="img" aria-label="Task dependency graph"></svg></div>
    <aside class="detail" id="detail" aria-live="polite"></aside>
  </div>
</section>
<script>
let META = { owners: [] };
let BOARD = { title: '', components: [] };
let view = location.hash === '#graph' ? 'graph' : 'board';
let focusOwner = null;
let pinned = null;
let dragTaskId = null;
const taskDrafts = new Map();
const pendingTasks = new Set();
const SVG = 'http://www.w3.org/2000/svg';

function showStatus(message, failed) {
  const status = document.getElementById('board-status');
  status.textContent = message;
  status.className = failed ? 'error' : '';
}

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v);
  }
  for (const child of children || []) node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  return node;
}
function svg(tag, attrs, children) {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  for (const child of children || []) node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  return node;
}

async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || ('Request failed: ' + res.status));
  }
  return res.json();
}
function post(body) {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
async function action(path, opts, onSaved) {
  try {
    await api(path, opts);
  } catch (error) {
    showStatus('Could not save: ' + error.message, true);
    render();
    return false;
  }
  if (onSaved) onSaved();
  try {
    BOARD = await api('/api/board');
    render();
    showStatus('Saved');
  } catch {
    showStatus('Saved, but the view could not refresh. Reload when the server is available.', true);
  }
  return true;
}

const tasks = () => BOARD.components.flatMap((c) => c.tasks);
const byId = () => new Map(tasks().map((t) => [t.id, t]));
const owner = (id) => META.owners.find((o) => o.id === id) || META.owners[0];
const agentLabel = (task) => (owner(task.owner).agents.find((a) => a.id === task.agent) || {}).label;
const STATUS = { done: 'Done', ready: 'Ready', blocked: 'Blocked' };

function renderProgress() {
  const all = tasks();
  const count = (s) => all.filter((t) => t.status === s).length;
  const total = all.length || 1;
  document.getElementById('bar-done').style.width = (count('done') / total) * 100 + '%';
  document.getElementById('bar-ready').style.width = (count('ready') / total) * 100 + '%';
  const text = document.getElementById('progress-text');
  text.replaceChildren(
    el('span', {}, [el('b', {}, [String(count('done'))]), ' of ' + all.length + ' done']),
    el('span', {}, [el('b', {}, [String(count('ready'))]), ' ready']),
    el('span', {}, [el('b', {}, [String(count('blocked'))]), ' blocked']),
  );
}

function renderLegend() {
  const legend = document.getElementById('owner-legend');
  legend.replaceChildren(...META.owners.filter((o) => o.agents.length || tasks().some((t) => t.owner === o.id)).map((o) => {
    const mine = tasks().filter((t) => t.owner === o.id);
    return el('button', {
      type: 'button', class: 'owner-key' + (focusOwner && focusOwner !== o.id ? ' faded' : ''), 'data-owner': o.id,
      'aria-pressed': String(focusOwner === o.id),
      onclick: () => { focusOwner = focusOwner === o.id ? null : o.id; render(); },
    }, [
      el('strong', {}, [o.label + ' · ' + mine.filter((t) => t.done).length + '/' + mine.length]),
      el('span', { class: 'hand' }, [o.agents.map((a) => a.label).join(', ') || 'no agent yet']),
    ]);
  }));
}

/* ---------- Board view ---------- */
function clearDrag() {
  dragTaskId = null;
  document.querySelectorAll('.dragging, .drag-over, .drop-slot.active').forEach((n) => n.classList.remove('dragging', 'drag-over', 'active'));
}
function dropTask(e, componentId, index) {
  if (!dragTaskId) return;
  e.preventDefault();
  e.stopPropagation();
  const taskId = dragTaskId;
  clearDrag();
  return action('/api/task/' + taskId + '/move', post({ componentId, index }));
}
function makeDropSlot(componentId, index) {
  const slot = el('div', { class: 'drop-slot' });
  slot.addEventListener('dragover', (e) => { if (dragTaskId) { e.preventDefault(); slot.classList.add('active'); } });
  slot.addEventListener('dragleave', () => slot.classList.remove('active'));
  slot.addEventListener('drop', (e) => dropTask(e, componentId, index));
  return slot;
}

function renderCard(component, task, index) {
  const all = byId();
  const card = el('article', {
    class: 'card' + (focusOwner && task.owner !== focusOwner ? ' faded' : ''), draggable: 'true',
    'data-owner': task.owner, 'data-status': task.status, 'aria-label': task.title + ', ' + STATUS[task.status],
  });
  card.addEventListener('dragstart', (e) => {
    if (e.target.closest('input, select, button')) { e.preventDefault(); return; }
    dragTaskId = task.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', task.id);
    card.classList.add('dragging');
  });
  card.addEventListener('dragend', clearDrag);
  card.addEventListener('drop', (e) => {
    const rect = card.getBoundingClientRect();
    return dropTask(e, component.id, index + (e.clientY >= rect.top + rect.height / 2 ? 1 : 0));
  });

  const checkbox = el('input', { type: 'checkbox', 'aria-label': 'Done: ' + task.title });
  checkbox.checked = task.done;
  checkbox.addEventListener('change', () => action('/api/task/' + task.id + '/toggle', post({ done: checkbox.checked })));
  const waiting = (task.dependsOn || []).filter((id) => all.has(id) && !all.get(id).done);
  const pill = el('span', { class: 'pill ' + task.status, title: waiting.length ? 'Waiting on ' + waiting.length : '' }, [
    task.status === 'blocked' ? 'Waiting on ' + waiting.length : STATUS[task.status],
  ]);
  card.appendChild(el('div', { class: 'card-top' }, [
    checkbox, el('span', { class: 'card-title' }, [task.title]), pill,
    el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Delete ' + task.title,
      onclick: () => action('/api/task/' + task.id, { method: 'DELETE' }) }, ['✕']),
  ]));

  const ownerSelect = el('select', { class: 'owner-select', 'data-owner': task.owner, 'aria-label': 'Owner of ' + task.title,
    onchange: (e) => action('/api/task/' + task.id + '/owner', post({ owner: e.target.value })) },
    META.owners.map((o) => el('option', { value: o.id, selected: o.id === task.owner }, [o.label])));
  const agents = owner(task.owner).agents;
  const meta = el('div', { class: 'card-meta' }, [ownerSelect]);
  if (agents.length) {
    meta.appendChild(el('select', { class: 'agent-select', 'aria-label': 'Agent in charge of ' + task.title,
      onchange: (e) => action('/api/task/' + task.id + '/agent', post({ agent: e.target.value || null })) },
      [el('option', { value: '' }, ['no agent'])].concat(agents.map((a) => el('option', { value: a.id, selected: a.id === task.agent }, [a.label])))));
  }
  card.appendChild(meta);

  const deps = el('div', { class: 'deps' });
  if ((task.dependsOn || []).length) deps.appendChild(el('span', { class: 'deps-label' }, ['waits on']));
  for (const id of task.dependsOn || []) {
    const dep = all.get(id);
    if (!dep) continue;
    deps.appendChild(el('span', { class: 'dep-chip ' + (dep.done ? 'done' : 'open'), 'data-owner': dep.owner, title: dep.title + ' (' + owner(dep.owner).label + ')' }, [
      el('span', {}, [dep.title]),
      el('button', { type: 'button', 'aria-label': 'Stop waiting on ' + dep.title,
        onclick: () => action('/api/task/' + task.id + '/depends', post({ dependsOn: task.dependsOn.filter((d) => d !== id) })) }, ['×']),
    ]));
  }
  const candidates = tasks().filter((t) => t.id !== task.id && !(task.dependsOn || []).includes(t.id));
  deps.appendChild(el('select', { class: 'dep-add', 'aria-label': 'Add a task that ' + task.title + ' waits on',
    onchange: (e) => e.target.value && action('/api/task/' + task.id + '/depends', post({ dependsOn: (task.dependsOn || []).concat(e.target.value) })) },
    [el('option', { value: '' }, ['+ waits on…'])].concat(candidates.map((t) => el('option', { value: t.id }, [owner(t.owner).label + ': ' + t.title])))));
  card.appendChild(deps);

  const move = el('select', { class: 'move-select', 'aria-label': 'Move ' + task.title + ' to another column',
    onchange: (e) => {
      const target = BOARD.components.find((c) => c.id === e.target.value);
      if (target) return action('/api/task/' + task.id + '/move', post({ componentId: target.id, index: target.tasks.length }));
    } }, [el('option', { value: '' }, ['Move to…'])].concat(BOARD.components.filter((c) => c.id !== component.id).map((c) => el('option', { value: c.id }, [c.name]))));
  card.appendChild(el('div', { class: 'card-bottom' }, [
    el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Move ' + task.title + ' up', onclick: () => action('/api/task/' + task.id + '/step', post({ direction: 'up' })) }, ['↑']),
    el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Move ' + task.title + ' down', onclick: () => action('/api/task/' + task.id + '/step', post({ direction: 'down' })) }, ['↓']),
    move,
  ]));
  return card;
}

function renderColumn(component) {
  const column = el('section', { class: 'column', 'aria-label': component.name });
  column.addEventListener('dragover', (e) => { if (dragTaskId) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; column.classList.add('drag-over'); } });
  column.addEventListener('dragleave', () => column.classList.remove('drag-over'));
  column.addEventListener('drop', (e) => dropTask(e, component.id, component.tasks.length));
  column.appendChild(el('div', { class: 'column-header' }, [
    el('input', { value: component.name, 'aria-label': 'Column name: ' + component.name,
      onchange: (e) => action('/api/component/' + component.id + '/rename', post({ name: e.target.value })) }),
    el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Remove column ' + component.name,
      onclick: () => confirm('Remove ' + component.name + ' and its cards?') && action('/api/component/' + component.id, { method: 'DELETE' }) }, ['✕']),
  ]));
  if (component.description) column.appendChild(el('p', { class: 'column-desc' }, [component.description]));
  const open = component.tasks.filter((t) => !t.done).length;
  column.appendChild(el('p', { class: 'column-count' }, [open ? open + ' open of ' + component.tasks.length : 'all ' + component.tasks.length + ' done']));
  const stack = el('div', { class: 'stack' }, [makeDropSlot(component.id, 0)]);
  component.tasks.forEach((task, index) => {
    stack.appendChild(renderCard(component, task, index));
    stack.appendChild(makeDropSlot(component.id, index + 1));
  });
  column.appendChild(stack);

  const ownerPick = el('select', { 'aria-label': 'Owner of the new task in ' + component.name },
    META.owners.map((o) => el('option', { value: o.id, selected: o.id === (focusOwner || 'unassigned') }, [o.label])));
  const input = el('input', { type: 'text', placeholder: 'Add task…', 'aria-label': 'New task in ' + component.name,
    'data-component': component.id, value: taskDrafts.get(component.id) || '', oninput: (e) => taskDrafts.set(component.id, e.target.value) });
  const add = el('button', { class: 'btn primary', type: 'submit', disabled: pendingTasks.has(component.id) }, ['Add']);
  column.appendChild(el('form', { class: 'add-task', onsubmit: async (e) => {
    e.preventDefault();
    const title = input.value.trim();
    if (!title) { showStatus('Enter a task title first.', true); input.focus(); return; }
    if (pendingTasks.has(component.id)) return;
    pendingTasks.add(component.id);
    await action('/api/task', post({ componentId: component.id, title, owner: ownerPick.value }), () => { taskDrafts.delete(component.id); input.value = ''; });
    pendingTasks.delete(component.id);
    render();
  } }, [input, ownerPick, add]));
  return column;
}

function renderBoard() {
  const focused = document.activeElement;
  const focusComponent = focused && focused.getAttribute && focused.getAttribute('data-component');
  const selection = focusComponent ? [focused.selectionStart, focused.selectionEnd] : null;
  const main = document.getElementById('board-main');
  main.replaceChildren(...BOARD.components.map(renderColumn), el('button', { class: 'add-column', type: 'button', onclick: async () => {
    const name = prompt('Column name (for example Voice or Demo):');
    if (name && name.trim()) await action('/api/component', post({ name: name.trim() }));
  } }, ['+ add a column']));
  if (focusComponent) {
    const input = Array.from(main.querySelectorAll('input[data-component]')).find((n) => n.dataset.component === focusComponent);
    if (input) { input.focus(); input.setSelectionRange(...selection); }
  }
}

/* ---------- Graph view ---------- */
const NODE_W = 236, NODE_H = 78, GAP_X = 96, GAP_Y = 20, PAD = 34, HEAD = 44;

// Layered left-to-right layout: a task's step is one past its latest dependency.
function layout() {
  const all = byId();
  const list = tasks();
  const rank = new Map();
  const rankOf = (t) => {
    if (rank.has(t.id)) return rank.get(t.id);
    rank.set(t.id, 0);
    const deps = (t.dependsOn || []).filter((id) => all.has(id));
    const r = deps.length ? 1 + Math.max(...deps.map((id) => rankOf(all.get(id)))) : 0;
    rank.set(t.id, r);
    return r;
  };
  const layers = [];
  for (const t of list) (layers[rankOf(t)] ||= []).push(t);
  const dependents = new Map(list.map((t) => [t.id, []]));
  for (const t of list) for (const id of t.dependsOn || []) if (dependents.has(id)) dependents.get(id).push(t.id);
  const pos = new Map();
  const place = () => layers.forEach((layer) => layer.forEach((t, i) => pos.set(t.id, (i + 0.5) / layer.length)));
  const centre = (ids, fallback) => (ids.length ? ids.reduce((s, id) => s + pos.get(id), 0) / ids.length : fallback);
  place();
  // A few barycentre sweeps pull linked tasks level with each other, which untangles edges.
  for (let pass = 0; pass < 4; pass++) {
    for (let r = 1; r < layers.length; r++) {
      layers[r].sort((a, b) => centre((a.dependsOn || []).filter((id) => pos.has(id)), pos.get(a.id)) - centre((b.dependsOn || []).filter((id) => pos.has(id)), pos.get(b.id)));
      place();
    }
    for (let r = layers.length - 2; r >= 0; r--) {
      layers[r].sort((a, b) => centre(dependents.get(a.id), pos.get(a.id)) - centre(dependents.get(b.id), pos.get(b.id)));
      place();
    }
  }
  const tallest = Math.max(1, ...layers.map((l) => l.length));
  const xy = new Map();
  layers.forEach((layer, r) => layer.forEach((t, i) => xy.set(t.id, {
    x: PAD + r * (NODE_W + GAP_X),
    y: PAD + HEAD + ((tallest - layer.length) / 2 + i) * (NODE_H + GAP_Y),
  })));
  return { layers, xy, dependents, width: PAD * 2 + layers.length * (NODE_W + GAP_X) - GAP_X, height: PAD * 2 + HEAD + tallest * (NODE_H + GAP_Y) - GAP_Y };
}

// The longest chain of unfinished tasks: nothing on it can start earlier, so it sets the finish date.
function criticalPath() {
  const all = byId();
  const memo = new Map();
  const best = (t) => {
    if (memo.has(t.id)) return memo.get(t.id);
    memo.set(t.id, { length: 1, via: null });
    let result = { length: 1, via: null };
    for (const id of t.dependsOn || []) {
      const dep = all.get(id);
      if (!dep || dep.done) continue;
      const chain = best(dep);
      if (chain.length + 1 > result.length) result = { length: chain.length + 1, via: id };
    }
    memo.set(t.id, result);
    return result;
  };
  let end = null;
  for (const t of tasks()) if (!t.done && (!end || best(t).length > best(end).length)) end = t;
  const nodes = new Set();
  const edges = new Set();
  for (let t = end; t; ) {
    nodes.add(t.id);
    const via = best(t).via;
    if (via) edges.add(via + '>' + t.id);
    t = via ? all.get(via) : null;
  }
  return nodes.size > 1 ? { nodes, edges } : { nodes: new Set(), edges: new Set() };
}

function wrap(text, max) {
  const words = text.split(' ');
  const lines = [''];
  for (const word of words) {
    const line = lines[lines.length - 1];
    if ((line + ' ' + word).trim().length > max && line) lines.push(word);
    else lines[lines.length - 1] = (line + ' ' + word).trim();
  }
  if (lines.length > 2) lines.splice(2, lines.length, lines[1].slice(0, max - 1) + '…');
  return lines;
}

function related(id, dependents) {
  const all = byId();
  const seen = new Set([id]);
  const walk = (start, next) => {
    const stack = [start];
    while (stack.length) for (const n of next(stack.pop())) if (!seen.has(n)) { seen.add(n); stack.push(n); }
  };
  walk(id, (n) => (all.get(n)?.dependsOn || []).filter((d) => all.has(d)));
  walk(id, (n) => dependents.get(n) || []);
  return seen;
}

function renderGraph() {
  const graph = document.getElementById('graph');
  const { layers, xy, dependents, width, height } = layout();
  const critical = criticalPath();
  const all = byId();
  graph.setAttribute('width', width);
  graph.setAttribute('height', height);
  graph.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
  const defs = svg('defs', {}, ['done', 'waiting'].map((kind) => svg('marker', {
    id: 'arrow-' + kind, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse',
  }, [svg('path', { d: 'M0 1 L9 5 L0 9 z', fill: kind === 'done' ? '#2e7d69' : '#c43d3d' })])));
  const rankLayer = svg('g');
  layers.forEach((layer, r) => {
    const x = PAD + r * (NODE_W + GAP_X);
    const label = r === 0 ? 'start here' : r === layers.length - 1 ? 'last step' : 'step ' + (r + 1);
    rankLayer.appendChild(svg('text', { class: 'rank-label', x: x + 4, y: PAD + 18 }, [label]));
    rankLayer.appendChild(svg('line', { class: 'rank-rule', x1: x, x2: x + NODE_W, y1: PAD + 28, y2: PAD + 28 }));
  });
  const ink = svg('g');
  const edgeLayer = svg('g');
  const edgeNodes = [];
  for (const t of tasks()) for (const id of t.dependsOn || []) {
    const from = xy.get(id), to = xy.get(t.id);
    if (!from || !to) continue;
    const x1 = from.x + NODE_W, y1 = from.y + NODE_H / 2, x2 = to.x - 4, y2 = to.y + NODE_H / 2;
    const bend = Math.max(40, (x2 - x1) / 2);
    const d = 'M' + x1 + ' ' + y1 + ' C' + (x1 + bend) + ' ' + y1 + ' ' + (x2 - bend) + ' ' + y2 + ' ' + x2 + ' ' + y2;
    const kind = all.get(id).done ? 'done' : 'waiting';
    if (critical.edges.has(id + '>' + t.id)) ink.appendChild(svg('path', { class: 'critical-ink', d }));
    const edge = svg('path', { class: 'edge ' + kind, d, 'marker-end': 'url(#arrow-' + kind + ')' });
    edge.dataset.from = id;
    edge.dataset.to = t.id;
    edgeLayer.appendChild(edge);
    edgeNodes.push(edge);
  }
  const nodeLayer = svg('g');
  const nodes = [];
  for (const t of tasks()) {
    const p = xy.get(t.id);
    const o = owner(t.owner);
    const g = svg('g', {
      class: 'node ' + t.status + (pinned === t.id ? ' pinned' : ''), 'data-owner': t.owner, tabindex: 0, role: 'button',
      transform: 'translate(' + p.x + ' ' + p.y + ')',
      'aria-label': t.title + ', ' + o.label + ', ' + STATUS[t.status],
    });
    g.dataset.id = t.id;
    if (critical.nodes.has(t.id)) g.appendChild(svg('rect', { class: 'node-halo', x: -5, y: -4, width: NODE_W + 10, height: NODE_H + 8, rx: 16, transform: 'rotate(-0.8 ' + NODE_W / 2 + ' ' + NODE_H / 2 + ')' }));
    g.appendChild(svg('rect', { class: 'node-card', width: NODE_W, height: NODE_H, rx: 12 }));
    g.appendChild(svg('rect', { class: 'node-stripe', x: 0, y: 10, width: 4, height: NODE_H - 20, rx: 2 }));
    wrap(t.title, 27).forEach((line, i) => g.appendChild(svg('text', { class: 'node-title', x: 16, y: 22 + i * 16 }, [line])));
    g.appendChild(svg('text', { class: 'node-owner', x: 16, y: NODE_H - 12 }, [o.label]));
    const agent = agentLabel(t);
    if (agent) g.appendChild(svg('text', { class: 'node-agent', x: 22 + o.label.length * 8, y: NODE_H - 11 }, [agent]));
    const bx = NODE_W - 17, by = 17;
    if (t.status === 'done') {
      g.appendChild(svg('circle', { class: 'badge-done', cx: bx, cy: by, r: 9 }));
      g.appendChild(svg('text', { class: 'badge-glyph', x: bx, y: by + 4, fill: '#fff' }, ['✓']));
    } else if (t.status === 'ready') {
      g.appendChild(svg('circle', { class: 'badge-ready', cx: bx, cy: by, r: 8 }));
      g.appendChild(svg('circle', { class: 'badge-ready-dot', cx: bx, cy: by, r: 3.5 }));
    } else {
      g.appendChild(svg('circle', { class: 'badge-blocked', cx: bx, cy: by, r: 9 }));
      g.appendChild(svg('text', { class: 'badge-glyph', x: bx, y: by + 4, fill: '#c43d3d' }, ['!']));
    }
    g.addEventListener('mouseenter', () => highlight(t.id));
    g.addEventListener('mouseleave', () => highlight(pinned));
    g.addEventListener('click', (e) => { e.stopPropagation(); pin(t.id); });
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pin(t.id); } });
    nodeLayer.appendChild(g);
    nodes.push(g);
  }
  graph.replaceChildren(defs, rankLayer, ink, edgeLayer, nodeLayer);
  graph.onclick = () => pin(null);

  function highlight(id) {
    const lit = id ? related(id, dependents) : null;
    for (const node of nodes) {
      const off = (lit && !lit.has(node.dataset.id)) || (!lit && focusOwner && node.dataset.owner !== focusOwner);
      node.classList.toggle('dim', Boolean(off));
    }
    for (const edge of edgeNodes) {
      const on = lit && lit.has(edge.dataset.from) && lit.has(edge.dataset.to);
      edge.classList.toggle('dim', Boolean(lit && !on) || Boolean(!lit && focusOwner && all.get(edge.dataset.to).owner !== focusOwner && all.get(edge.dataset.from).owner !== focusOwner));
      edge.classList.toggle('lit', Boolean(on));
    }
  }
  highlight(pinned);
  renderDetail(dependents);
}

function pin(id) {
  pinned = pinned === id ? null : id;
  renderGraph();
}

function renderDetail(dependents) {
  const panel = document.getElementById('detail');
  const all = byId();
  const t = pinned && all.get(pinned);
  if (!t) {
    const critical = criticalPath();
    const chain = tasks().filter((x) => critical.nodes.has(x.id));
    panel.removeAttribute('data-owner');
    panel.replaceChildren(
      el('p', { class: 'hint' }, ['hover a task to trace what it waits on and what it unblocks. click to pin it.']),
      el('h3', {}, ['critical path · ' + chain.length + ' steps']),
      chain.length ? el('ul', {}, chain.map((x) => el('li', { 'data-owner': x.owner }, [owner(x.owner).label + ': ' + x.title]))) : el('p', { class: 'empty' }, ['Nothing is waiting on anything.']),
    );
    return;
  }
  const o = owner(t.owner);
  const list = (ids, empty) => ids.length
    ? el('ul', {}, ids.map((id) => all.get(id)).filter(Boolean).map((x) => el('li', { 'data-owner': x.owner }, [
      owner(x.owner).label + ': ' + x.title + ' ', el('span', { class: 'pill ' + x.status }, [STATUS[x.status]]),
    ])))
    : el('p', { class: 'empty' }, [empty]);
  panel.setAttribute('data-owner', t.owner);
  panel.replaceChildren(
    el('span', { class: 'pill ' + t.status }, [STATUS[t.status]]),
    el('h2', {}, [t.title]),
    el('p', { class: 'who' }, [o.label, el('span', { class: 'hand' }, [agentLabel(t) || 'no agent yet'])]),
    el('h3', {}, ['waits on']),
    list((t.dependsOn || []).filter((id) => all.has(id)), 'Nothing. It can start any time.'),
    el('h3', {}, ['unblocks']),
    list(dependents.get(t.id) || [], 'Nothing waits on this.'),
    el('button', { class: 'btn' + (t.done ? '' : ' primary'), type: 'button',
      onclick: () => action('/api/task/' + t.id + '/toggle', post({ done: !t.done })) }, [t.done ? 'Reopen' : 'Mark done']),
  );
}

function render() {
  document.getElementById('board-title').textContent = BOARD.title || 'Ming';
  document.getElementById('tab-board').setAttribute('aria-selected', String(view === 'board'));
  document.getElementById('tab-graph').setAttribute('aria-selected', String(view === 'graph'));
  document.getElementById('board-main').hidden = view !== 'board';
  document.getElementById('graph-view').hidden = view !== 'graph';
  renderProgress();
  renderLegend();
  if (view === 'board') renderBoard();
  else renderGraph();
}

function setView(next) {
  view = next;
  history.replaceState(null, '', next === 'graph' ? '#graph' : '#board');
  render();
}

async function init() {
  document.getElementById('tab-board').addEventListener('click', () => setView('board'));
  document.getElementById('tab-graph').addEventListener('click', () => setView('graph'));
  window.addEventListener('hashchange', () => { view = location.hash === '#graph' ? 'graph' : 'board'; render(); });
  META = await api('/api/meta');
  BOARD = await api('/api/board');
  render();
  showStatus('Ready. Drag cards to reorder; open Graph to see who is waiting on whom.');
  const source = new EventSource('/events');
  source.onmessage = (e) => {
    BOARD = JSON.parse(e.data);
    if (pinned && !byId().has(pinned)) pinned = null;
    render();
  };
  source.onerror = () => showStatus('Live connection lost. Check that the board server is running.', true);
}
init().catch((error) => showStatus('Could not load the board: ' + error.message, true));
</script>
</body>
</html>`;
}
