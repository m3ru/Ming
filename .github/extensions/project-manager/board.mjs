// board.mjs — durable data model for Ming's project-manager Kanban board.
// Columns = components. Each column holds an ordered stack of task cards
// (stack order = priority). Every card has an owner, the owner's agent in
// charge of it, and the cards it depends on. Status is derived, never stored:
// done, ready (every dependency done) or blocked.
//
// Sessions sharing this local file coordinate through its write lock;
// open panels poll it for changes. Separate checkouts share changes via Git.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Override only when intentionally using an isolated board (e.g. tests).
const BOARD_PATH = path.resolve(process.env.PROJECT_MANAGER_BOARD_PATH || path.join(__dirname, "data/board.json"));
const DATA_DIR = path.dirname(BOARD_PATH);
const LOCK_PATH = `${BOARD_PATH}.lock`;

// Colours come from Ming's "Director's notes" palette (src/app/globals.css).
export const OWNERS = [
    { id: "unassigned", label: "Unassigned", color: "#6b7076", tint: "#ecedea", agents: [] },
    { id: "sin", label: "Sin", color: "#3557c8", tint: "#e6ebfa", agents: [
        { id: "sin-claude", label: "Claude Code · Opus 5.5" },
        { id: "sin-codex", label: "Codex" },
    ] },
    { id: "meru", label: "Meru", color: "#2e7d69", tint: "#e2f0eb", agents: [
        { id: "meru-copilot", label: "Copilot coding agent" },
        { id: "meru-claude", label: "Claude Code · Sonnet 5.5" },
    ] },
    { id: "ian", label: "Ian", color: "#a8620a", tint: "#fbefdc", agents: [
        { id: "ian-copilot", label: "Copilot CLI" },
        { id: "ian-codex", label: "Codex" },
    ] },
    { id: "renato", label: "Renato", color: "#8a3fa0", tint: "#f3e7f7", agents: [
        { id: "renato-codex", label: "Codex" },
        { id: "renato-claude", label: "Claude Code · Opus 5.5" },
    ] },
];

export const events = new EventEmitter();

function defaultBoard() {
    return {
        schemaVersion: 1,
        title: "Ming · Project Plan",
        components: ["Backend contract", "Backend routing", "Frontend", "Demo"].map((name) => ({
            id: randomUUID(),
            name,
            tasks: [],
        })),
    };
}

// All participants lock the same path before reading, including initialization.
// Never steal an old lock: a slow writer may still own it.
async function withLock(fn) {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const deadline = Date.now() + 5000;
    let lock;
    while (!lock) {
        try {
            lock = await fs.open(LOCK_PATH, "wx");
        } catch (err) {
            if (err.code !== "EEXIST") throw err;
            if (Date.now() >= deadline) {
                throw new Error(`Board is locked: ${LOCK_PATH}. Stop all board processes before removing an abandoned lock.`);
            }
            await delay(20);
        }
    }
    try {
        return await fn();
    } finally {
        await lock.close();
        await fs.unlink(LOCK_PATH);
    }
}

async function persist(board) {
    const temporaryPath = `${BOARD_PATH}.${randomUUID()}.tmp`;
    try {
        await fs.writeFile(temporaryPath, JSON.stringify(board, null, 2) + "\n", { flag: "wx" });
        await fs.rename(temporaryPath, BOARD_PATH);
    } finally {
        await fs.rm(temporaryPath, { force: true });
    }
}

let lastSnapshot;

async function transaction(fn) {
    return withLock(async () => {
        let board;
        let needsWrite = false;
        try {
            board = JSON.parse(await fs.readFile(BOARD_PATH, "utf8"));
        } catch (err) {
            if (err.code !== "ENOENT") throw err;
            board = defaultBoard();
            needsWrite = true;
        }
        // A failed mutation discards this private copy without touching disk.
        const result = fn?.(board);
        if (fn || needsWrite) await persist(board);
        const snapshot = JSON.stringify(board);
        if (snapshot !== lastSnapshot) {
            lastSnapshot = snapshot;
            events.emit("changed", board);
        }
        return result ?? board;
    });
}

// Each server owns a polling subscription and cancels it on close. Polling the
// path also detects atomic replacement (Git/editor saves), unlike inode watches.
export function watchBoard() {
    let pending = null;
    let previousError;
    const timer = setInterval(() => {
        if (pending) return;
        pending = getBoard().then(() => { previousError = undefined; }).catch((err) => {
            if (err.message !== previousError) console.error("Project Manager refresh failed:", err.message);
            previousError = err.message;
        }).finally(() => { pending = null; });
    }, 500);
    timer.unref();
    return async () => {
        clearInterval(timer);
        await pending;
    };
}

function allTasks(board) {
    return board.components.flatMap((component) => component.tasks);
}

/** done, ready (every dependency done) or blocked. Unknown dependency ids never block. */
export function taskStatus(board, task) {
    if (task.done) return "done";
    const byId = new Map(allTasks(board).map((t) => [t.id, t]));
    return (task.dependsOn ?? []).some((id) => byId.has(id) && !byId.get(id).done) ? "blocked" : "ready";
}

/** A copy for display: each task carries its derived status. Never persisted. */
export function withStatus(board) {
    return {
        ...board,
        components: board.components.map((component) => ({
            ...component,
            tasks: component.tasks.map((task) => ({ ...task, status: taskStatus(board, task) })),
        })),
    };
}

function findComponent(board, componentId) {
    const component = board.components.find((c) => c.id === componentId);
    if (!component) throw new Error(`Unknown component: ${componentId}`);
    return component;
}

function findTask(board, taskId) {
    for (const component of board.components) {
        const index = component.tasks.findIndex((t) => t.id === taskId);
        if (index !== -1) return { component, index, task: component.tasks[index] };
    }
    throw new Error(`Unknown task: ${taskId}`);
}

function findOwner(owner) {
    const person = OWNERS.find((p) => p.id === owner);
    if (!person) throw new Error(`Unknown owner: ${owner}`);
    return person;
}

function clampIndex(index, length) {
    if (typeof index !== "number" || Number.isNaN(index)) return length;
    return Math.max(0, Math.min(index, length));
}

async function mutate(fn) {
    return transaction(fn);
}

export async function getBoard() {
    return transaction();
}

export async function addComponent(name) {
    if (!name || !name.trim()) throw new Error("Component name is required");
    return mutate((board) => {
        const component = { id: randomUUID(), name: name.trim(), tasks: [] };
        board.components.push(component);
        return component;
    });
}

export async function removeComponent(componentId) {
    return mutate((board) => {
        const idx = board.components.findIndex((c) => c.id === componentId);
        if (idx === -1) throw new Error(`Unknown component: ${componentId}`);
        const removed = new Set(board.components[idx].tasks.map((t) => t.id));
        board.components.splice(idx, 1);
        // A deleted card must not keep blocking the cards that waited on it.
        for (const task of allTasks(board))
            if (task.dependsOn) task.dependsOn = task.dependsOn.filter((id) => !removed.has(id));
    });
}

export async function renameComponent(componentId, name) {
    if (!name || !name.trim()) throw new Error("Component name is required");
    return mutate((board) => {
        const component = findComponent(board, componentId);
        component.name = name.trim();
    });
}

// Adds a task to the bottom of a column's stack.
export async function addTask(componentId, title, owner = "unassigned") {
    findOwner(owner);
    if (!title || !title.trim()) throw new Error("Task title is required");
    return mutate((board) => {
        const component = findComponent(board, componentId);
        const task = { id: randomUUID(), title: title.trim(), done: false, owner, dependsOn: [] };
        component.tasks.push(task);
        return task;
    });
}

// Changing the owner clears an agent that belongs to someone else.
export async function setTaskOwner(taskId, owner) {
    const person = findOwner(owner);
    return mutate((board) => {
        const { task } = findTask(board, taskId);
        task.owner = owner;
        if (task.agent && !person.agents.some((agent) => agent.id === task.agent)) delete task.agent;
        return task;
    });
}

// An agent works for its owner: only the task owner's agents can take charge.
export async function setTaskAgent(taskId, agent) {
    return mutate((board) => {
        const { task } = findTask(board, taskId);
        if (!agent) {
            delete task.agent;
            return task;
        }
        if (!findOwner(task.owner).agents.some((a) => a.id === agent))
            throw new Error(`Agent ${agent} does not work for ${task.owner}`);
        task.agent = agent;
        return task;
    });
}

// Replaces a task's dependencies. Rejects unknown tasks, self-links and cycles.
export async function setTaskDependencies(taskId, dependsOn) {
    if (!Array.isArray(dependsOn)) throw new Error("dependsOn must be a list of task ids");
    return mutate((board) => {
        const { task } = findTask(board, taskId);
        const ids = [...new Set(dependsOn)];
        for (const id of ids) {
            if (id === taskId) throw new Error("A task cannot depend on itself");
            findTask(board, id);
        }
        const byId = new Map(allTasks(board).map((t) => [t.id, t]));
        // Walking upstream from each new dependency must never reach this task.
        const seen = new Set();
        const stack = [...ids];
        while (stack.length) {
            const id = stack.pop();
            if (id === taskId) throw new Error("That dependency would create a cycle");
            if (seen.has(id)) continue;
            seen.add(id);
            stack.push(...(byId.get(id)?.dependsOn ?? []));
        }
        task.dependsOn = ids;
        return task;
    });
}

export async function toggleTask(taskId, done) {
    return mutate((board) => {
        const { task } = findTask(board, taskId);
        task.done = typeof done === "boolean" ? done : !task.done;
        return task;
    });
}

export async function removeTask(taskId) {
    return mutate((board) => {
        const { component, index } = findTask(board, taskId);
        component.tasks.splice(index, 1);
        for (const task of allTasks(board))
            if (task.dependsOn) task.dependsOn = task.dependsOn.filter((id) => id !== taskId);
    });
}

// Moves a task card to `targetComponentId` at `targetIndex` in that column's
// stack. Works for both cross-column moves and same-column reordering.
export async function moveTask(taskId, targetComponentId, targetIndex) {
    return mutate((board) => {
        const { component: sourceComponent, index: sourceIndex, task } = findTask(board, taskId);
        const targetComponent = findComponent(board, targetComponentId);
        sourceComponent.tasks.splice(sourceIndex, 1);
        const sameColumn = sourceComponent.id === targetComponent.id;
        let insertAt = clampIndex(targetIndex, targetComponent.tasks.length);
        // If we just removed the card from earlier in the same column, later
        // target indexes shift left by one to land in the intended slot.
        if (sameColumn && sourceIndex < insertAt) insertAt = Math.max(0, insertAt - 1);
        targetComponent.tasks.splice(insertAt, 0, task);
        return task;
    });
}

// Convenience swap-with-neighbor helpers for up/down controls.
export async function moveTaskStep(taskId, direction) {
    return mutate((board) => {
        const { component, index } = findTask(board, taskId);
        const targetIndex = direction === "up" ? index - 1 : index + 1;
        if (targetIndex < 0 || targetIndex >= component.tasks.length) return component.tasks[index];
        const [task] = component.tasks.splice(index, 1);
        component.tasks.splice(targetIndex, 0, task);
        return task;
    });
}
