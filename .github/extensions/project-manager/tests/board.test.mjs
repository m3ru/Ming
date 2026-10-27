import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

async function fixture(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ming-board-'));
    const boardPath = path.join(directory, 'board.json');
    const children = [];
    t.after(async () => {
        await Promise.all(children.map(async (child) => {
            if (child.exitCode !== null || child.signalCode !== null) return;
            const exited = once(child, 'exit');
            child.kill();
            await exited;
        }));
        await fs.rm(directory, { recursive: true, force: true });
    });
    async function worker() {
        const child = fork(new URL('./worker.mjs', import.meta.url), [], {
            env: { ...process.env, PROJECT_MANAGER_BOARD_PATH: boardPath },
            stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
        });
        children.push(child);
        await once(child, 'message');
        let nextId = 0;
        const waiting = new Map();
        child.on('message', ({ id, result, error }) => {
            const pending = waiting.get(id);
            if (!pending) return;
            waiting.delete(id);
            clearTimeout(pending.timer);
            if (error) pending.reject(new Error(error));
            else pending.resolve(result);
        });
        return (action, ...args) => new Promise((resolve, reject) => {
            const id = nextId++;
            const timer = setTimeout(() => {
                waiting.delete(id);
                reject(new Error(`Worker timed out: ${action}`));
            }, 10000);
            waiting.set(id, { resolve, reject, timer });
            child.send({ id, action, args });
        });
    }
    return { boardPath, directory, worker };
}

// A small plan: Ian's routing waits on Sin's contract; Renato's merge waits on both.
const plan = { schemaVersion: 1, title: 'Plan', components: [{ id: 'col', name: 'Column', tasks: [
    { id: 'contract', title: 'Contract', done: false, owner: 'sin', agent: 'sin-claude', dependsOn: [] },
    { id: 'routing', title: 'Routing', done: false, owner: 'ian', agent: 'ian-copilot', dependsOn: ['contract'] },
    { id: 'merge', title: 'Merge', done: false, owner: 'renato', agent: 'renato-codex', dependsOn: ['contract', 'routing'] },
] }] };

test('concurrent initialization and same/cross-process writes preserve every task', { timeout: 15000 }, async (t) => {
    const f = await fixture(t);
    const workers = await Promise.all(Array.from({ length: 4 }, () => f.worker()));
    const initial = await Promise.all(workers.map((call) => call('getBoard')));
    initial.forEach((board) => assert.deepEqual(board, initial[0]));
    const componentId = initial[0].components[0].id;
    let reading = true;
    const reader = (async () => {
        while (reading) {
            JSON.parse(await fs.readFile(f.boardPath, 'utf8'));
            await delay(1);
        }
    })();
    try {
        await Promise.all(workers.map((call, index) => call('batch', componentId, `writer-${index}`, 20)));
    } finally {
        reading = false;
        await reader;
    }
    const latest = await Promise.all(workers.map((call) => call('getBoard')));
    latest.forEach((board) => assert.deepEqual(board, latest[0]));
    const tasks = latest[0].components[0].tasks;
    assert.equal(tasks.length, 80);
    assert.equal(new Set(tasks.map((task) => task.title)).size, 80);
    assert.deepEqual(await fs.readdir(f.directory), ['board.json']);
});

test('failed operations and invalid JSON never overwrite the board', async (t) => {
    const f = await fixture(t);
    await fs.writeFile(f.boardPath, JSON.stringify(plan));
    const call = await f.worker();
    const before = await fs.readFile(f.boardPath, 'utf8');
    await assert.rejects(call('moveTask', 'contract', 'missing', 0), /Unknown component/);
    assert.equal(await fs.readFile(f.boardPath, 'utf8'), before);
    await fs.writeFile(f.boardPath, '{broken');
    await assert.rejects(call('addComponent', 'Do not overwrite'));
    assert.equal(await fs.readFile(f.boardPath, 'utf8'), '{broken');
    await fs.writeFile(f.boardPath, before);
    await call('addComponent', 'Recovered');
    assert.equal((await call('getBoard')).components.length, 2);
});

test('an open SSE stream receives another process and external file replacements', { timeout: 15000 }, async (t) => {
    const f = await fixture(t);
    const observer = await f.worker();
    const writer = await f.worker();
    const url = await observer('start');
    const controller = new AbortController();
    t.after(() => controller.abort());
    const response = await fetch(new URL('events', url), { signal: controller.signal });
    assert.equal(response.status, 200);
    const reader = response.body.getReader();
    let buffer = '';
    async function nextBoard() {
        while (!buffer.includes('\n\n')) {
            const { value, done } = await reader.read();
            assert.equal(done, false);
            buffer += new TextDecoder().decode(value);
        }
        const boundary = buffer.indexOf('\n\n');
        const message = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        return JSON.parse(message.slice('data: '.length));
    }
    const initial = await nextBoard();
    await writer('addTask', initial.components[0].id, 'Other process', 'meru');
    const changed = await nextBoard();
    assert.equal(changed.components[0].tasks[0].title, 'Other process');
    // The stream carries derived status, which is never written to disk.
    assert.equal(changed.components[0].tasks[0].status, 'ready');
    assert.doesNotMatch(await fs.readFile(f.boardPath, 'utf8'), /"status"/);
    changed.title = 'External replacement';
    await fs.writeFile(`${f.boardPath}.replacement`, JSON.stringify(changed));
    await fs.rename(`${f.boardPath}.replacement`, f.boardPath);
    assert.equal((await nextBoard()).title, 'External replacement');
    await fs.writeFile(f.boardPath, '{temporarily invalid');
    await delay(650);
    changed.title = 'Recovered after invalid JSON';
    await fs.writeFile(`${f.boardPath}.replacement`, JSON.stringify(changed));
    await fs.rename(`${f.boardPath}.replacement`, f.boardPath);
    assert.equal((await nextBoard()).title, 'Recovered after invalid JSON');
    assert.equal(await observer('close'), 0);
    assert.equal((await reader.read()).done, true);
});

test('an occupied lock times out without stealing it or changing board data', { timeout: 10000 }, async (t) => {
    const f = await fixture(t);
    const call = await f.worker();
    await call('getBoard');
    const before = await fs.readFile(f.boardPath, 'utf8');
    await fs.writeFile(`${f.boardPath}.lock`, 'another owner');
    await assert.rejects(call('addComponent', 'Blocked'), /Board is locked/);
    assert.equal(await fs.readFile(`${f.boardPath}.lock`, 'utf8'), 'another owner');
    assert.equal(await fs.readFile(f.boardPath, 'utf8'), before);
    await fs.unlink(`${f.boardPath}.lock`);
    await call('addComponent', 'Recovered');
});

test('status follows dependencies, and cycles, self-links and unknown tasks are refused', async (t) => {
    const f = await fixture(t);
    await fs.writeFile(f.boardPath, JSON.stringify(plan));
    const call = await f.worker();
    assert.deepEqual(await call('statuses'), { contract: 'ready', routing: 'blocked', merge: 'blocked' });
    await call('toggleTask', 'contract', true);
    // Renato's merge still waits on Ian's routing.
    assert.deepEqual(await call('statuses'), { contract: 'done', routing: 'ready', merge: 'blocked' });
    await call('toggleTask', 'routing', true);
    assert.equal((await call('statuses')).merge, 'ready');

    const before = await fs.readFile(f.boardPath, 'utf8');
    await assert.rejects(call('setTaskDependencies', 'contract', ['merge']), /cycle/);
    await assert.rejects(call('setTaskDependencies', 'routing', ['routing']), /itself/);
    await assert.rejects(call('setTaskDependencies', 'routing', ['missing']), /Unknown task/);
    assert.equal(await fs.readFile(f.boardPath, 'utf8'), before);
    assert.deepEqual((await call('setTaskDependencies', 'merge', ['routing', 'routing'])).dependsOn, ['routing']);

    // A deleted card stops blocking the cards that waited on it.
    await call('toggleTask', 'routing', false);
    assert.equal((await call('statuses')).merge, 'blocked');
    await call('removeTask', 'routing');
    const tasks = (await call('getBoard')).components[0].tasks;
    assert.deepEqual(tasks.find((task) => task.id === 'merge').dependsOn, []);
    assert.equal((await call('statuses')).merge, 'ready');
});

test('agents only work for their owner, and an owner change clears a foreign agent', async (t) => {
    const f = await fixture(t);
    await fs.writeFile(f.boardPath, JSON.stringify(plan));
    const call = await f.worker();
    await assert.rejects(call('setTaskAgent', 'contract', 'ian-copilot'), /does not work for sin/);
    assert.equal((await call('setTaskAgent', 'contract', 'sin-codex')).agent, 'sin-codex');
    assert.equal((await call('setTaskOwner', 'contract', 'meru')).agent, undefined);
    assert.equal((await call('setTaskAgent', 'contract', 'meru-copilot')).agent, 'meru-copilot');
    assert.equal((await call('setTaskAgent', 'contract', null)).agent, undefined);
    await assert.rejects(call('setTaskOwner', 'contract', 'william'), /Unknown owner/);
    assert.equal((await call('addTask', 'col', 'New task')).owner, 'unassigned');
});

test('HTTP serves owners with agents, statuses, and dependency edits', async (t) => {
    const f = await fixture(t);
    await fs.writeFile(f.boardPath, JSON.stringify(plan));
    const call = await f.worker();
    const url = await call('start');
    const html = await (await fetch(url)).text();
    assert.match(html, /id="graph"/);
    assert.match(html, /agent-select/);
    const meta = await (await fetch(new URL('api/meta', url))).json();
    assert.deepEqual(meta.owners.map((person) => person.id), ['unassigned', 'sin', 'meru', 'ian', 'renato']);
    assert.ok(meta.owners.slice(1).every((person) => person.agents.length));
    const board = await (await fetch(new URL('api/board', url))).json();
    assert.deepEqual(board.components[0].tasks.map((task) => task.status), ['ready', 'blocked', 'blocked']);
    const depends = (body) => fetch(new URL('api/task/contract/depends', url), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const refused = await depends({ dependsOn: ['merge'] });
    assert.equal(refused.status, 400);
    assert.match((await refused.json()).error, /cycle/);
    const agent = await fetch(new URL('api/task/routing/agent', url), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agent: 'ian-codex' }),
    });
    assert.equal((await agent.json()).agent, 'ian-codex');
    // Every page edit goes through the page's own post() helper: it must carry the JSON body.
    const start = html.indexOf('function post(');
    const post = new Function(html.slice(start, html.indexOf('\n}', start) + 2) + '\nreturn post;')();
    const picked = await fetch(new URL('api/task/routing/agent', url), post({ agent: 'ian-copilot' }));
    assert.equal((await picked.json()).agent, 'ian-copilot');
    const moved = await fetch(new URL('api/task/merge/owner', url), post({ owner: 'meru' }));
    assert.equal((await moved.json()).owner, 'meru');
    assert.equal(await call('close'), 0);
});

test('the committed sample plan has no cycles, unknown links or misassigned agents', async (t) => {
    const f = await fixture(t);
    const committed = JSON.parse(await fs.readFile(new URL('../data/board.json', import.meta.url), 'utf8'));
    await fs.writeFile(f.boardPath, JSON.stringify(committed));
    const call = await f.worker();
    const tasks = committed.components.flatMap((component) => component.tasks);
    assert.equal(new Set(tasks.map((task) => task.id)).size, tasks.length, 'task ids are unique');
    // Re-applying each task's own links runs the same checks an edit would.
    for (const task of tasks) {
        await call('setTaskDependencies', task.id, task.dependsOn);
        if (task.agent) await call('setTaskAgent', task.id, task.agent);
    }
    const statuses = await call('statuses');
    for (const status of ['done', 'ready', 'blocked'])
        assert.ok(Object.values(statuses).includes(status), 'the sample shows ' + status + ' work');
});
