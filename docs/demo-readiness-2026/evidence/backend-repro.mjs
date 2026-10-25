// Run from the repository root:
//   node docs/demo-readiness-2026/evidence/backend-repro.mjs
// Uses synthetic data and in-memory mocks. Does not import the app's database,
// load .env, start a listening server, or make provider/network requests.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const rootRequire = createRequire(join(root, "package.json"));
const backendRequire = createRequire(join(root, "src/backend/package.json"));
const ts = rootRequire("typescript");
const originalFetch = globalThis.fetch;
let attemptedNetworkCalls = 0;
globalThis.fetch = async () => {
  attemptedNetworkCalls++;
  throw new Error("Network is disabled by the backend audit reproduction.");
};

// Transpile selected source modules in memory; all relative app imports must be
// explicitly mocked, so accidentally importing a real agent/database fails.
function loadTs(relativePath, mocks = {}) {
  const source = readFileSync(join(root, relativePath), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  });
  const module = { exports: {} };
  const require = (id) => {
    if (Object.hasOwn(mocks, id)) return mocks[id];
    if (id.startsWith(".") || id.startsWith("@/")) {
      throw new Error(`Unexpected app import in ${relativePath}: ${id}`);
    }
    return backendRequire(id);
  };
  new Function("require", "module", "exports", outputText)(
    require,
    module,
    module.exports,
  );
  return module.exports;
}

async function checkUnauthenticatedMemoryRoutes() {
  const source = readFileSync(
    join(root, "src/backend/src/mastra/index.ts"),
    "utf8",
  );
  assert.match(source, /server:\s*\{\s*apiRoutes,\s*\}/);
  assert.doesNotMatch(source, /experimental_auth/);

  const { Mastra } = backendRequire("@mastra/core/mastra");
  const { createHonoServer } = backendRequire("@mastra/deployer/server");
  const queryCalls = [];
  const memory = {
    getThreadById: async ({ threadId }) => ({
      id: threadId,
      resourceId: "synthetic-owner",
      title: "Synthetic private practice",
    }),
    getThreadsByResourceId: async ({ resourceId }) => [
      { id: "synthetic-thread", resourceId, title: "Synthetic private practice" },
    ],
    query: async (input) => {
      queryCalls.push(input);
      return {
        messages: [
          {
            id: "synthetic-message",
            role: "user",
            content: "Synthetic private transcript",
            threadId: "synthetic-thread",
            resourceId: "synthetic-owner",
          },
        ],
        uiMessages: [],
      };
    },
  };
  // Match the app's server authentication configuration. Disable telemetry for
  // this isolated harness and replace only the memory data source.
  const mastra = new Mastra({
    server: { apiRoutes: [] },
    telemetry: { enabled: false },
  });
  mastra.getAgent = () => ({ getMemory: async () => memory });
  const app = await createHonoServer(mastra);
  const urls = [
    "/api/memory/threads?agentId=defaultAgent&resourceid=synthetic-owner",
    "/api/memory/threads/synthetic-thread?agentId=defaultAgent",
    "/api/memory/threads/synthetic-thread/messages?agentId=defaultAgent",
  ];
  for (const url of urls) {
    // No Authorization header, cookie, or authenticated user context.
    const response = await app.request(url);
    assert.equal(response.status, 200, url);
    const text = await response.text();
    assert.match(text, /synthetic-/);
    if (url.includes("/messages?")) {
      assert.match(text, /Synthetic private transcript/);
    }
  }
  assert.equal(queryCalls.length, 1);
  assert.equal(queryCalls[0].threadId, "synthetic-thread");
  assert.equal(queryCalls[0].resourceId, undefined);
  console.log(
    "PASS real router: 3 unauthenticated memory reads returned 200; synthetic transcript exposed; message query has no resourceId.",
  );
}

async function checkRealWorkflows() {
  const agent = (text) => ({ generateVNext: async () => ({ text }) });
  const mocks = {
    "../agents/transcriptAnalyzerAgent": {
      transcriptAnalyzerAgent: agent(
        "<segment:Introduction>user: Synthetic hello</segment:Introduction>",
      ),
    },
    "../agents/transcriptSummaryAnalyzerAgent": {
      transcriptSummaryAnalyzerAgent: agent("Synthetic summary"),
    },
    "../agents/transcriptDetailAgent": {
      transcriptDetailAgent: agent("Synthetic detail"),
    },
    "../agents/scenarioCreateAgent": {
      scenarioCreateAgent: agent("Synthetic scenario"),
    },
    "../agents/promptCreateAgent": {
      promptCreateAgent: agent("Synthetic prompts"),
    },
    "../agents/reportCreateAgent": {
      reportCreateAgent: agent("Synthetic reports"),
    },
  };
  const cases = [
    {
      name: "feedbackOrchestratorWorkflow",
      file: "src/backend/src/mastra/workflows/feedbackOrchestratorWorkflow.ts",
      input: { transcript: "user: Synthetic hello" },
      fields: ["segmentedAnalysis", "summaryAnalysis", "detailedFeedback"],
      absent: "combinedReport",
    },
    {
      name: "scenarioPipelineWorkflow",
      file: "src/backend/src/mastra/workflows/scenarioPipelineWorkflow.ts",
      input: { analysis: "Synthetic analysis" },
      fields: ["scenario", "prompts", "reports"],
      absent: "combinedPackage",
    },
  ];
  for (const item of cases) {
    const loaded = loadTs(item.file, mocks);
    const run = await loaded[item.name].createRunAsync();
    const result = await run.start({ inputData: item.input });
    assert.equal(result.status, "success", item.name);
    for (const field of item.fields) {
      assert.equal(typeof result.result[field], "string");
      assert.ok(result.result[field].length > 0);
    }
    assert.equal(result.result[item.absent], undefined);
  }
  console.log(
    "PASS real workflows: both status=success with UI-used fields; absent combinedReport/combinedPackage do not cause failure.",
  );
}

async function checkVoiceService() {
  const { createLiveVoiceService, voiceSessionSchema } = loadTs(
    "src/backend/src/lib/voice.ts",
  );
  const { bartPrompt } = loadTs("src/backend/src/lib/prompts.ts");
  let providerCalls = 0;
  const payloads = [];
  const saves = [];
  const dependencies = {
    apiKey: () => "synthetic-key-not-a-credential",
    generate: async () => "Synthetic reply",
    save: async (messages, scope) => {
      saves.push({
        messages,
        threadId: scope.threadId,
        resourceId: scope.resourceId,
      });
    },
    request: async (_url, init) => {
      providerCalls++;
      payloads.push(JSON.parse(init.body));
      return Response.json({
        session: { id: `synthetic-live-${providerCalls}` },
        transport: { sdp: "synthetic-answer" },
      });
    },
  };
  const input = {
    sdp: "synthetic-offer",
    threadId: "caller-chosen-thread",
    resourceId: "caller-chosen-resource",
    context: { chatType: { data: "scenario" } },
    messages: [],
  };
  const firstInstance = createLiveVoiceService(dependencies);
  const session = await firstInstance.create(input);
  await firstInstance.sync(
    {
      sessionId: session.sessionId,
      messages: [
        {
          id: `voice-${session.sessionId}-user-0`,
          role: "user",
          content: "Synthetic injected caption",
          createdAt: "2026-10-24T00:00:00.000Z",
        },
      ],
    },
    session.token,
  );
  assert.equal(saves[0].threadId, input.threadId);
  assert.equal(saves[0].resourceId, input.resourceId);
  console.log(
    "PASS voice scope: caller-chosen thread/resource reach the save dependency after anonymous session creation.",
  );

  const secondInstance = createLiveVoiceService(dependencies);
  await assert.rejects(
    secondInstance.sync(
      { sessionId: session.sessionId, messages: [] },
      session.token,
    ),
    (error) => error.status === 401,
  );
  console.log(
    "PASS voice instance split: a capability created in instance A receives 401 in instance B.",
  );

  assert.match(payloads[0].session.instructions, /defensive and frustrated/);
  assert.match(bartPrompt, /Be apologetic but not defensive/);
  console.log(
    "PASS persona contradiction: Live startup says defensive/frustrated; delegated Bart prompt says apologetic/not defensive.",
  );

  for (let i = 1; i < 100; i++) await firstInstance.create(input);
  await assert.rejects(
    firstInstance.create(input),
    (error) => error.status === 429,
  );
  assert.equal(typeof firstInstance.close, "undefined");
  console.log(
    "PASS sequential capacity: create 101 receives 429; service has no close/release method for the retained entries.",
  );

  const concurrent = createLiveVoiceService(dependencies);
  const results = await Promise.allSettled(
    Array.from({ length: 110 }, () => concurrent.create(input)),
  );
  const succeeded = results.filter((result) => result.status === "fulfilled");
  assert.equal(succeeded.length, 110);
  console.log(
    "PASS concurrent capacity: 110 simultaneous creates all succeed despite the nominal 100-session cap.",
  );

  const historyService = createLiveVoiceService(dependencies);
  const historyInput = voiceSessionSchema.parse({
    ...input,
    messages: Array.from({ length: 128 }, (_, index) => ({
      id: `synthetic-history-${index}`,
      role: index % 2 ? "assistant" : "user",
      content: "Yes",
      createdAt: "2026-10-24T00:00:00.000Z",
    })),
  });
  await historyService.create(historyInput);
  assert.equal(payloads.at(-1).session.input.length, 129);
  // Current official Create session docs specify at most 128 startup messages:
  // https://developers.openai.com/api/reference/resources/live/methods/create
  console.log(
    "PASS history count: 128 accepted short messages produce 129 provider startup items; documented maximum is 128.",
  );
}

async function checkSummaryHtmlPreservation() {
  const evaluation = loadTs("src/lib/evaluation.ts");
  const { default: Parser } = loadTs("src/app/report/parser.tsx", {
    "@/lib/evaluation": evaluation,
  });
  const { marked } = rootRequire("marked");
  const payload =
    '<img src="x" onerror="document.documentElement.dataset.mingAudit=1">';
  const parsed = Parser(
    JSON.stringify({
      summary: `## CONVERSATION OVERVIEW\n${payload}\n\n## USER PERFORMANCE ANALYSIS\nSynthetic feedback\n`,
      detail: "",
    }),
  );
  assert.equal(parsed.summary, payload);
  const html = marked.parse(parsed.summary);
  assert.equal(html.trim(), payload);
  assert.match(
    readFileSync(join(root, "src/app/report/page.tsx"), "utf8"),
    /dangerouslySetInnerHTML=\{\{ __html: marked\.parse\(summary\) \}\}/,
  );
  console.log(
    "PASS summary HTML: real Parser + marked preserve a harmless onerror attribute for the HTML sink; script does not execute it.",
  );
}

try {
  console.log("Backend audit reproduction: synthetic data, in-memory execution.");
  await checkUnauthenticatedMemoryRoutes();
  await checkRealWorkflows();
  await checkVoiceService();
  await checkSummaryHtmlPreservation();
  assert.equal(attemptedNetworkCalls, 0);
  console.log("PASS isolation: 0 network/provider calls; no real database or .env loaded.");
} finally {
  globalThis.fetch = originalFetch;
}
