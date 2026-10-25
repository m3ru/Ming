// Run after `npm --prefix src/backend run build`.
// Starts the real built backend on an isolated test port with no provider key.
// Sends one synthetic local request; no provider can be called without a key.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { once } from 'node:events';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const evidence = fileURLToPath(new URL('./', import.meta.url));
const childEnv = { ...process.env, PORT: '44119' };
delete childEnv.OPENAI_API_KEY;
delete childEnv.MASTRA_CLOUD_ACCESS_TOKEN;
const child = spawn(process.execPath, [
  '--import=./.mastra/output/instrumentation.mjs', '.mastra/output/index.mjs',
], { cwd: root + 'src/backend', env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '';
let readyResolve;
const ready = new Promise(resolve => { readyResolve = resolve; });
for (const output of [child.stdout, child.stderr]) {
  output.on('data', chunk => {
    logs += chunk;
    if (logs.includes('Mastra API running')) readyResolve();
  });
}
const closed = once(child, 'close');
const deadline = setTimeout(() => child.kill('SIGTERM'), 15000);
try {
  await Promise.race([ready, closed.then(() => { throw new Error('Backend exited before ready'); })]);
  const response = await fetch('http://127.0.0.1:44119/chat/stream', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: 'Synthetic audit: discuss missed deadlines and an improvement plan.',
      additionalContext: { chatType: { data: 'scenario', source: 'subscription' } },
      resourceId: 'demo-audit-synthetic-resource', threadId: 'demo-audit-synthetic-thread',
    }), signal: AbortSignal.timeout(10000),
  });
  console.log('Node:', process.version);
  console.log('HTTP:', response.status);
  console.log('SSE:', (await response.text()).trim());
  const outcome = await Promise.race([
    closed.then(([code, signal]) => ({ code, signal })),
    new Promise(resolve => setTimeout(() => resolve({ survived: true }), 2000)),
  ]);
  console.log('Process outcome:', JSON.stringify(outcome));
} finally {
  clearTimeout(deadline);
  if (child.exitCode === null) child.kill('SIGTERM');
  writeFileSync(evidence + 'runtime-no-key-server.log', logs);
}
