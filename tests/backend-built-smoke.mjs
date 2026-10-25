// Smoke the actual production output with synthetic gateway credentials and no
// provider key. SQLite files live only in a temporary directory.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const temporary = await mkdtemp(join(tmpdir(), "ming-built-security-"));
const token = "synthetic-gateway-token-with-at-least-32-characters";
async function withBackend(configured, run) {
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const env = {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(port),
    MING_DATABASE_URL: "file:" + join(temporary, "memory.db"),
    MASTRA_DEFAULT_STORAGE_URL: "file:" + join(temporary, "mastra.db"),
  };
  delete env.OPENAI_API_KEY;
  delete env.GEMINI_API_KEY;
  delete env.GOOGLE_GENERATIVE_AI_API_KEY;
  delete env.GOOGLE_API_KEY;
  delete env.DEEPGRAM_API_KEY;
  env.MING_TEXT_PROVIDER = "gemini";
  env.MING_VOICE_PROVIDER = "openai";
  delete env.MASTRA_CLOUD_ACCESS_TOKEN;
  delete env.MING_BACKEND_TOKEN;
  if (configured) env.MING_BACKEND_TOKEN = token;
  const child = spawn(process.execPath, [".mastra/output/index.mjs"], {
    cwd: fileURLToPath(new URL("../src/backend/", import.meta.url)),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  for (const output of [child.stdout, child.stderr])
    output.on("data", (data) => {
      logs += data;
    });
  const closed = once(child, "close");
  const deadline = setTimeout(() => child.kill("SIGTERM"), 15000);
  try {
    const readyDeadline = Date.now() + 10_000;
    let ready = false;
    while (Date.now() < readyDeadline && child.exitCode === null) {
      try {
        const response = await fetch("http://127.0.0.1:" + port + "/", {
          signal: AbortSignal.timeout(500),
        });
        ready = response.status === (configured ? 401 : 503);
        if (ready) break;
      } catch {
        /* The process has not started listening yet. */
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready, "Backend did not become ready: " + logs.slice(-1500));
    await run("http://127.0.0.1:" + port);
    assert.equal(child.exitCode, null);
  } finally {
    clearTimeout(deadline);
    child.kill("SIGTERM");
    await closed;
  }
}
try {
  const headers = {
    "Content-Type": "application/ming+json",
    "x-ming-gateway-token": token,
    "x-ming-user-id": "synthetic-owner",
  };
  const body = JSON.stringify({
    prompt: "Synthetic no-key regression",
    threadId: "synthetic-no-key",
    resourceId: "forged-resource",
  });
  await withBackend(false, async (url) => {
    assert.equal(
      (
        await fetch(url + "/chat/stream", {
          method: "POST",
          headers,
          body,
          signal: AbortSignal.timeout(5000),
        })
      ).status,
      503,
    );
  });
  await withBackend(true, async (url) => {
    assert.equal(
      (
        await fetch(url + "/chat/stream", {
          method: "POST",
          headers: { "Content-Type": "application/ming+json" },
          body,
          signal: AbortSignal.timeout(5000),
        })
      ).status,
      401,
    );
    for (const path of [
      "/api",
      "/api/agents",
      "/api/memory/threads",
      "/api/workflows",
      "/a2a/defaultAgent",
      "/openapi.json",
    ]) {
      assert.equal(
        (
          await fetch(url + path, {
            headers,
            signal: AbortSignal.timeout(5000),
          })
        ).status,
        404,
        path,
      );
    }
    for (let i = 0; i < 2; i++) {
      const response = await fetch(url + "/chat/stream", {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(5000),
      });
      assert.equal(response.status, 503);
      assert.equal((await response.json()).code, "AI_NOT_CONFIGURED");
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  });
  console.log(
    "PASS: production backend fails closed on missing gateway config, rejects anonymous access, blocks built-in APIs and survives repeated keyless requests.",
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
