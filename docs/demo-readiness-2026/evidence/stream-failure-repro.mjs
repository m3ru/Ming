// From the repository root:
//   node docs/demo-readiness-2026/evidence/stream-failure-repro.mjs
// The parent asserts expected child exits. A child with tracing enabled is
// expected to crash. No actual provider, network, .env, or private DB is used.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const file = fileURLToPath(import.meta.url);
const mode = process.argv[2];

async function child() {
  delete process.env.OPENAI_API_KEY;
  delete process.env.MASTRA_CLOUD_ACCESS_TOKEN;
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls++;
    throw new Error("Network is disabled by this audit.");
  };
  const output = console.log.bind(console);
  // Keep the matrix readable. An unhandled rejection still reaches Node's
  // native stderr and terminates the process; no rejection handler is added.
  for (const method of ["log", "error", "warn", "info", "debug"]) {
    console[method] = () => {};
  }

  const rootRequire = createRequire(join(root, "package.json"));
  const require = createRequire(join(root, "src/backend/package.json"));
  const ts = rootRequire("typescript");
  const { Agent } = require("@mastra/core/agent");
  const { Mastra } = require("@mastra/core/mastra");
  const { Memory } = require("@mastra/memory");
  const { LibSQLStore } = require("@mastra/libsql");
  const tracing = process.env.MING_AUDIT_TRACING === "1";
  const withMemory = process.env.MING_AUDIT_MEMORY === "1";

  function load(relativePath, mocks = {}) {
    const { outputText } = ts.transpileModule(
      readFileSync(join(root, relativePath), "utf8"),
      {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.CommonJS,
          esModuleInterop: true,
        },
      },
    );
    const module = { exports: {} };
    new Function("require", "module", "exports", outputText)(
      (id) => {
        if (Object.hasOwn(mocks, id)) return mocks[id];
        if (id.startsWith(".") || id.startsWith("@/")) {
          throw new Error(`Unexpected app import: ${id}`);
        }
        return require(id);
      },
      module,
      module.exports,
    );
    return module.exports;
  }

  // A model implementing the actual AI SDK v2 interface. This reproduces an
  // ordinary provider failure without calling OpenAI or needing credentials.
  const model = {
    specificationVersion: "v2",
    provider: "synthetic-audit",
    modelId: "synthetic-model",
    supportedUrls: {},
    doGenerate: async () => {
      throw new Error("Synthetic provider failure");
    },
    doStream: async () => {
      throw new Error("Synthetic provider failure");
    },
  };
  const storage = new LibSQLStore({ url: ":memory:" });
  const agent = new Agent({
    name: "synthetic-stream-audit",
    model,
    instructions: "",
    ...(withMemory
      ? {
          memory: new Memory({
            storage,
            options: {
              workingMemory: { enabled: true },
              threads: { generateTitle: true },
            },
          }),
        }
      : {}),
  });
  const utils = load("src/backend/src/utils/streamUtils.ts");
  const { chatWorkflow } = load(
    "src/backend/src/mastra/workflows/chatWorkflow.ts",
    {
      "../agents/helloWorldAgent": { helloWorldAgent: null },
      "../agents/defaultAgent": { defaultAgent: agent },
      "../../utils/streamUtils": utils,
      "./chatWorkflowTypes": load(
        "src/backend/src/mastra/workflows/chatWorkflowTypes.ts",
      ),
    },
  );
  new Mastra({
    agents: { defaultAgent: agent },
    workflows: { chatWorkflow },
    storage,
    telemetry: { enabled: false },
    observability: { default: { enabled: tracing } },
  });

  let status;
  const response = utils.createSSEStream(async (controller) => {
    const run = await chatWorkflow.createRunAsync();
    const result = await run.start({
      inputData: {
        prompt: "Synthetic hello",
        additionalContext: {},
        streamController: controller,
        ...(withMemory
          ? { threadId: "synthetic-thread", resourceId: "synthetic-resource" }
          : {}),
      },
    });
    status = result.status;
    if (result.status !== "success") {
      throw new Error(`Workflow failed: ${result.status}`);
    }
  });
  const sse = await response.text();
  output("AUDIT_RESULT " + JSON.stringify({ status, sse, networkCalls }));
  // Give unhandled rejections time to reach Node's default fatal handler.
  await new Promise((resolve) => setTimeout(resolve, 100));
  output("AUDIT_SURVIVED");
  process.exit(0);
}

if (mode === "--child") {
  await child();
} else {
  const require = createRequire(join(root, "src/backend/package.json"));
  const { version: mastraVersion } = require("@mastra/core/package.json");
  const config = readFileSync(
    join(root, "src/backend/src/mastra/index.ts"),
    "utf8",
  );
  assert.match(config, /observability:\s*\{\s*default:\s*\{\s*enabled:\s*true/);
  console.log(`Stream failure matrix: Node ${process.version}; Mastra ${mastraVersion}.`);
  console.log("Synthetic provider throws; actual chatWorkflow + SSE source; in-memory SQLite; fetch blocked.");
  for (const tracing of [false, true]) {
    for (const withMemory of [false, true]) {
      const result = spawnSync(process.execPath, [file, "--child"], {
        cwd: root,
        env: {
          ...process.env,
          MING_AUDIT_TRACING: tracing ? "1" : "0",
          MING_AUDIT_MEMORY: withMemory ? "1" : "0",
        },
        encoding: "utf8",
        timeout: 10000,
      });
      assert.equal(result.error, undefined);
      const line = result.stdout
        .split("\n")
        .find((value) => value.startsWith("AUDIT_RESULT "));
      assert.ok(line, result.stderr);
      const observed = JSON.parse(line.slice("AUDIT_RESULT ".length));
      assert.equal(observed.networkCalls, 0);
      assert.equal(result.status, tracing ? 1 : 0);
      assert.equal(observed.status, tracing ? "failed" : "success");
      assert.equal(result.stdout.includes("AUDIT_SURVIVED"), !tracing);
      if (tracing) {
        assert.match(result.stderr, /triggerUncaughtException/);
        assert.match(result.stderr, /Synthetic provider failure/);
        assert.match(observed.sse, /"type":"error"/);
      } else {
        assert.equal(observed.sse, "event: done\ndata:\n\n");
      }
      console.log(
        `PASS tracing=${tracing ? "on" : "off"}, memory=${withMemory ? "on" : "off"}: ` +
          `workflow=${observed.status}, SSE=${tracing ? "error" : "empty done"}, ` +
          `exit=${result.status}, network=0.`,
      );
    }
  }
  console.log("Confirmed: current tracing configuration makes a synthetic provider error fatal; disabling tracing alone silently reports empty success.");
  console.log("Scope: reproduced on the displayed Node/Mastra versions; this script does not test other runtime versions.");
}
