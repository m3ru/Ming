// Extension: project-manager
// Ming's project Kanban for GitHub Copilot: components form the columns, each
// holding an ordered stack of task cards. Every card has an owner (Sin, Meru,
// Ian, Renato or Unassigned), the owner's agent in charge of it, and the cards
// it depends on. Status is derived: done, ready (every dependency done) or
// blocked. Backed by one committed JSON file (data/board.json) so the whole
// team and every agent session see the same plan.

import { joinSession, createCanvas, CanvasError } from "@github/copilot-sdk/extension";
import { startServer } from "./server.mjs";
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
} from "./board.mjs";

// One local HTTP server per open canvas instance; all instances read/write
// the same board.json and are kept in sync live via SSE.
const servers = new Map();

function wrap(fn) {
    return async (ctx) => {
        try {
            return await fn(ctx.input || {});
        } catch (err) {
            throw new CanvasError("project_manager_error", String(err && err.message ? err.message : err));
        }
    };
}

const ownerIds = OWNERS.map((person) => person.id);
const agentIds = OWNERS.flatMap((person) => person.agents.map((agent) => agent.id));

await joinSession({
    canvases: [
        createCanvas({
            id: "project-manager",
            displayName: "Ming Project Board",
            description:
                "Ming's project Kanban and dependency graph. Cards have an owner (Sin, Meru, Ian, Renato or Unassigned), the owner's agent in charge, and the cards they depend on. A card is ready when everything it depends on is done, otherwise blocked. Do not infer owners or agents from column names.",
            inputSchema: { type: "object", properties: {} },
            actions: [
                {
                    name: "get_board",
                    description: "Read the board: owners and their agents come from the meta, columns hold ordered tasks, each with owner, agent, dependsOn and derived status.",
                    handler: wrap(async () => ({ owners: OWNERS, board: withStatus(await getBoard()) })),
                },
                {
                    name: "add_component",
                    description: "Add a column to the board.",
                    inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
                    handler: wrap(async ({ name }) => addComponent(name)),
                },
                {
                    name: "remove_component",
                    description: "Remove a column and its tasks by id. Other tasks stop depending on the removed ones.",
                    inputSchema: { type: "object", properties: { componentId: { type: "string" } }, required: ["componentId"] },
                    handler: wrap(async ({ componentId }) => {
                        await removeComponent(componentId);
                        return { ok: true };
                    }),
                },
                {
                    name: "rename_component",
                    description: "Rename a column.",
                    inputSchema: {
                        type: "object",
                        properties: { componentId: { type: "string" }, name: { type: "string" } },
                        required: ["componentId", "name"],
                    },
                    handler: wrap(async ({ componentId, name }) => {
                        await renameComponent(componentId, name);
                        return { ok: true };
                    }),
                },
                {
                    name: "add_task",
                    description: "Add a task to the bottom of a column. Omit owner to leave it unassigned; assign a person only when ownership is agreed.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            componentId: { type: "string" },
                            owner: { type: "string", enum: ownerIds },
                            title: { type: "string" },
                        },
                        required: ["componentId", "title"],
                    },
                    handler: wrap(async ({ componentId, title, owner }) => addTask(componentId, title, owner)),
                },
                {
                    name: "toggle_task",
                    description: "Mark a task done or not done by id. Omit 'done' to flip it.",
                    inputSchema: {
                        type: "object",
                        properties: { taskId: { type: "string" }, done: { type: "boolean" } },
                        required: ["taskId"],
                    },
                    handler: wrap(async ({ taskId, done }) => toggleTask(taskId, done)),
                },
                {
                    name: "set_task_owner",
                    description: "Assign a task to sin, meru, ian or renato, or clear it with unassigned. An agent that does not work for the new owner is cleared.",
                    inputSchema: {
                        type: "object",
                        properties: { taskId: { type: "string" }, owner: { type: "string", enum: ownerIds } },
                        required: ["taskId", "owner"],
                    },
                    handler: wrap(async ({ taskId, owner }) => setTaskOwner(taskId, owner)),
                },
                {
                    name: "set_task_agent",
                    description: "Put one of the task owner's agents in charge of a task, or clear it with null. Agents only work for their own owner.",
                    inputSchema: {
                        type: "object",
                        properties: { taskId: { type: "string" }, agent: { type: ["string", "null"], enum: [...agentIds, null] } },
                        required: ["taskId", "agent"],
                    },
                    handler: wrap(async ({ taskId, agent }) => setTaskAgent(taskId, agent)),
                },
                {
                    name: "set_task_dependencies",
                    description: "Replace the list of task ids this task waits on. Unknown ids, self-links and cycles are rejected.",
                    inputSchema: {
                        type: "object",
                        properties: { taskId: { type: "string" }, dependsOn: { type: "array", items: { type: "string" } } },
                        required: ["taskId", "dependsOn"],
                    },
                    handler: wrap(async ({ taskId, dependsOn }) => setTaskDependencies(taskId, dependsOn)),
                },
                {
                    name: "move_task",
                    description: "Move a task to a column and stack position (0 = top).",
                    inputSchema: {
                        type: "object",
                        properties: {
                            taskId: { type: "string" },
                            componentId: { type: "string" },
                            index: { type: "integer", minimum: 0 },
                        },
                        required: ["taskId", "componentId", "index"],
                    },
                    handler: wrap(async ({ taskId, componentId, index }) => moveTask(taskId, componentId, index)),
                },
                {
                    name: "move_task_step",
                    description: "Move a task one position up or down within its column.",
                    inputSchema: {
                        type: "object",
                        properties: { taskId: { type: "string" }, direction: { type: "string", enum: ["up", "down"] } },
                        required: ["taskId", "direction"],
                    },
                    handler: wrap(async ({ taskId, direction }) => moveTaskStep(taskId, direction)),
                },
                {
                    name: "remove_task",
                    description: "Remove a task by id. Tasks that waited on it stop waiting.",
                    inputSchema: { type: "object", properties: { taskId: { type: "string" } }, required: ["taskId"] },
                    handler: wrap(async ({ taskId }) => {
                        await removeTask(taskId);
                        return { ok: true };
                    }),
                },
            ],
            // Idempotent: re-opens with the same instanceId reuse the same loopback
            // server; the board lives in board.json, not in memory per instance.
            open: async (ctx) => {
                let entry = servers.get(ctx.instanceId);
                if (!entry) {
                    entry = await startServer();
                    servers.set(ctx.instanceId, entry);
                }
                return { title: "Ming Project Board", url: entry.url };
            },
            onClose: async (ctx) => {
                const entry = servers.get(ctx.instanceId);
                if (entry) {
                    servers.delete(ctx.instanceId);
                    await entry.close();
                }
            },
        }),
    ],
});
