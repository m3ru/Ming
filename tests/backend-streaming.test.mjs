import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { backendRequire, loadBackendSource, loadReportWorkflow, loadReportService, root, streamedText } from "./backend-runtime.mjs";

const file = fileURLToPath(import.meta.url);

async function exerciseRuntime(withMemory) {
  delete process.env.OPENAI_API_KEY;
  process.env.MING_TEXT_PROVIDER = "openai";
  delete process.env.MASTRA_CLOUD_ACCESS_TOKEN;
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls++;
    throw new Error("Network is disabled by the backend regression test.");
  };
  const output = console.log.bind(console);
  // Do not install unhandledRejection/uncaughtException handlers: the child
  // must fail under Node's normal fatal policy if tracing regresses.
  for (const method of ["log", "error", "warn", "info", "debug"]) {
    console[method] = () => {};
  }

  const { Agent } = backendRequire("@mastra/core/agent");
  const { Memory } = backendRequire("@mastra/memory");
  const { LibSQLStore } = backendRequire("@mastra/libsql");
  const { createHonoServer } = backendRequire("@mastra/deployer/server");
  let mode = "throw";
  let modelCalls = 0;
  const secret = "synthetic-provider-secret-and-transcript";
  const reply = "Recovered reply";
  const model = {
    specificationVersion: "v2",
    provider: "synthetic-regression",
    modelId: "synthetic-model",
    supportedUrls: {},
    doGenerate: async () => ({
      content: [{ type: "text", text: "Synthetic conversation" }],
      finishReason: "stop",
      usage: { inputTokens: 1, outputTokens: 1 },
      warnings: [],
    }),
    doStream: async () => {
      modelCalls++;
      if (mode === "throw") throw new Error(secret);
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            if (mode === "healthy" || mode === "partial-error") {
              controller.enqueue({ type: "text-start", id: "text-1" });
              controller.enqueue({
                type: "text-delta",
                id: "text-1",
                delta: mode === "healthy" ? reply : "Partial reply",
              });
              controller.enqueue({ type: "text-end", id: "text-1" });
            }
            if (mode === "chunk-error" || mode === "partial-error") {
              controller.enqueue({ type: "error", error: new Error(secret) });
            } else {
              controller.enqueue({
                type: "finish",
                finishReason: "stop",
                usage: { inputTokens: 1, outputTokens: 1 },
              });
            }
            controller.close();
          },
        }),
      };
    },
  };
  const storage = new LibSQLStore({ url: ":memory:" });
  const memory = withMemory
    ? new Memory({
        storage,
        options: {
          workingMemory: { enabled: true },
          threads: { generateTitle: true },
        },
      })
    : undefined;
  const agents = Object.fromEntries(
    [
      "helloWorldAgent",
      "defaultAgent",
      "workingMemoryAgent",
      "transcriptSummaryAnalyzerAgent",
      "transcriptAnalyzerAgent",
      "transcriptDetailAgent",
      "reportAnnotationAgent",
      "scenarioCreateAgent",
      "promptCreateAgent",
      "reportCreateAgent",
      "feedbackReplyAgent",
    ].map((name) => [
      name,
      new Agent({
        name,
        model,
        instructions: "",
        ...(name === "defaultAgent" && memory ? { memory } : {}),
      }),
    ]),
  );
  const agentMocks = Object.fromEntries(
    Object.entries(agents).map(([name, agent]) => [
      `../agents/${name}`,
      { [name]: agent },
    ]),
  );
  const utils = loadBackendSource("src/backend/src/utils/streamUtils.ts");
  const chat = loadBackendSource(
    "src/backend/src/mastra/workflows/chatWorkflow.ts",
    {
      ...agentMocks,
      "../../utils/streamUtils": utils,
      "../../lib/prompts": loadBackendSource("src/backend/src/lib/prompts.ts"),
      "./chatWorkflowTypes": loadBackendSource(
        "src/backend/src/mastra/workflows/chatWorkflowTypes.ts",
      ),
      "../../lib/providers": loadBackendSource("src/backend/src/lib/providers.ts"),
    },
  );
  const feedback = loadReportWorkflow(agentMocks, loadBackendSource("src/backend/src/lib/providers.ts"));
  const scenario = loadBackendSource(
    "src/backend/src/mastra/workflows/scenarioPipelineWorkflow.ts",
    { ...agentMocks, "../../lib/scenarioSchema": loadBackendSource("src/backend/src/lib/scenarioSchema.ts"), "../../lib/providers": loadBackendSource("src/backend/src/lib/providers.ts") },
  );
  process.env.MING_BACKEND_TOKEN =
    "synthetic-gateway-token-with-at-least-32-characters";
  const security = loadBackendSource("src/backend/src/lib/security.ts", {
    "../mastra/agents/defaultAgent": { defaultAgent: agents.defaultAgent },
  });
  const registry = loadBackendSource("src/backend/src/mastra/apiRegistry.ts", {
    "./workflows/chatWorkflow": chat,
    "./reportService": loadReportService(feedback, loadBackendSource("src/backend/src/lib/providers.ts"), security),
    "./workflows/scenarioPipelineWorkflow": scenario,
    "../lib/security": {
      ...security,
      ...(!withMemory ? { claimThread: async () => {} } : {}),
    },
    "../utils/streamUtils": utils,
    "./liveVoice": { liveVoice: {} },
    "./deepgramVoice": { deepgramVoice: {} },
    "../lib/deepgramVoice": loadBackendSource("src/backend/src/lib/deepgramVoice.ts", {
      "./voice": loadBackendSource("src/backend/src/lib/voice.ts", { "./prompts": loadBackendSource("src/backend/src/lib/prompts.ts") }),
    }),
    "./models": { isTextConfigured: () => Boolean(process.env.OPENAI_API_KEY?.trim()) },
    "./sentiment": {
      scoreSentiment: () => {
        throw new Error("Not under test");
      },
    },
    "../lib/sentiment": loadBackendSource("src/backend/src/lib/sentiment.ts"),
    "../lib/voice": loadBackendSource("src/backend/src/lib/voice.ts", { "./prompts": loadBackendSource("src/backend/src/lib/prompts.ts") }),
  });
  const { mastra } = loadBackendSource("src/backend/src/mastra/index.ts", {
    ...Object.fromEntries(
      Object.entries(agents).map(([name, agent]) => [
        `./agents/${name}`,
        { [name]: agent },
      ]),
    ),
    "./workflows/chatWorkflow": chat,
    "./workflows/feedbackOrchestratorWorkflow": feedback,
    "./workflows/scenarioPipelineWorkflow": scenario,
    "./apiRegistry": registry,
    "./memory": { storage },
    "../lib/security": security,
  });
  const app = await createHonoServer(mastra);
  const scope = {
    resourceId: "synthetic-resource",
    threadId: "synthetic-thread",
  };
  if (memory) {
    await memory.createThread({ ...scope, title: "Synthetic conversation" });
    await memory.saveMessages({
      format: "v2",
      messages: [
        {
          id: "existing-transcript",
          role: "user",
          type: "text",
          content: {
            format: 2,
            parts: [{ type: "text", text: "Keep this transcript" }],
          },
          createdAt: new Date("2026-10-24T00:00:00Z"),
          ...scope,
        },
      ],
    });
  }
  const request = (
    body = {
      prompt: "Synthetic hello",
      additionalContext: { chatType: { data: "scenario" } },
      ...scope,
    },
  ) =>
    app.request("/chat/stream", {
      method: "POST",
      headers: {
        "Content-Type": "application/ming+json",
        "x-ming-gateway-token": process.env.MING_BACKEND_TOKEN,
        "x-ming-user-id": "synthetic-resource",
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  // Preflight never touches the model and is safe to retry after fixing config.
  for (const key of [undefined, "   "]) {
    if (key === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = key;
    const response = await request();
    assert.equal(response.status, 503);
    const error = await response.json();
    assert.equal(error.code, "AI_NOT_CONFIGURED");
    assert.equal(error.retryable, true);
    assert.match(error.message, /OPENAI_API_KEY/);
    assert.equal(modelCalls, 0);
  }
  process.env.OPENAI_API_KEY = "synthetic-not-a-real-key";
  for (const body of ["{", {}, { prompt: "   " }]) {
    const response = await request(body);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "INVALID_CHAT_REQUEST");
    assert.equal(modelCalls, 0);
  }

  for (const failure of ["throw", "chunk-error", "partial-error", "empty"]) {
    mode = failure;
    const failed = await request();
    assert.equal(failed.status, 200); // Error occurs after SSE headers start.
    const failedSse = await failed.text();
    assert.match(failedSse, /"type":"error"/);
    assert.match(failedSse, /"retryable":true/);
    assert.doesNotMatch(failedSse, /event: done/);
    assert.doesNotMatch(failedSse, new RegExp(secret));
    // Complete words reach the client; the censor's held-back last word could be half a swear
    // word, so a reply that fails mid-stream drops it rather than sending it uncensored.
    if (failure === "partial-error") assert.equal(streamedText(failedSse), "Partial ");

    // Leave time for detached promise rejections before attempting recovery.
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (memory) {
      const { messagesV2 } = await memory.query(scope);
      assert.ok(
        messagesV2.some((message) => message.id === "existing-transcript"),
      );
      assert.ok(
        messagesV2.some(
          (message) =>
            message.role === "user" &&
            message.content.parts.some(
              (part) =>
                part.type === "text" && part.text.includes("Synthetic hello"),
            ),
        ),
        "The failed request must retain its user message in memory",
      );
    }
    mode = "healthy";
    const healthy = await request();
    assert.equal(healthy.status, 200);
    const healthySse = await healthy.text();
    // The censor holds back each trailing word; every held word still reaches the client.
    assert.equal(streamedText(healthySse), reply);
    assert.match(healthySse, /event: done/);
    assert.doesNotMatch(healthySse, /"type":"error"/);
    if (memory) {
      const { messagesV2 } = await memory.query(scope);
      assert.equal(
        messagesV2.filter(
          (message) =>
            message.role === "user" &&
            message.content.parts.some(
              (part) => part.type === "text" && part.text === "Synthetic hello",
            ),
        ).length,
        modelCalls,
        "Each request keeps exactly one user message, including successful completions",
      );
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(networkCalls, 0);
  assert.equal(modelCalls, 8);
  output(
    JSON.stringify({ survived: true, withMemory, networkCalls, modelCalls }),
  );
  // SQLite/runtime handles do not define the assertion; all SSE requests and
  // delayed rejection checks completed above, under Node's fatal policy.
  process.exit(0);
}

if (process.argv.includes("--runtime-child")) {
  await exerciseRuntime(process.argv.includes("--memory"));
} else {
  function reportFixture({ provider = "gemini", model = "gemini-3.5-flash", truncatedStage, finishReason } = {}) {
    const stages = [], calls = [];
    const texts = [
      '## CONVERSATION OVERVIEW\nHello.\n## IMPROVEMENT RECOMMENDATIONS\nAsk a follow-up.',
      JSON.stringify({ segments: [{ title: "opening", startLine: 0, highlights: [] }] }),
    ];
    const workflow = { then(step) { stages.push(step); return this; }, commit() { return this; } };
    const agentMocks = Object.fromEntries([
      "transcriptSummaryAnalyzerAgent", "reportAnnotationAgent",
    ].map((name, index) => [`../agents/${name}`, { [name]: {
      async generateVNext(messages, options) {
        calls.push({ messages, options });
        return { text: index === truncatedStage ? 'incomplete {"summary' : texts[index], finishReason: index === truncatedStage ? "length" : finishReason };
      },
    } }]));
    loadReportWorkflow(agentMocks, { resolveTextProvider: () => ({ provider, model }) }, {
      ...agentMocks,
      "@mastra/core/workflows": { createStep: (step) => step, createWorkflow: () => workflow },
      "@mastra/core/di": { RuntimeContext: Map },
    });
    return { calls, texts, async run() {
      let inputData = { transcript: "user: Hello", additionalContext: {} };
      const runtimeContext = new Map();
      for (const step of stages) inputData = await step.execute({ inputData, runtimeContext });
      return inputData;
    } };
  }

  test("report stages preserve complete short output and apply provider-specific reasoning budgets", async () => {
    for (const [provider, model, lowThinking] of [
      ["gemini", "gemini-3.8-flash", true],
      ["gemini", "gemini-3.5-flash", true],
      ["gemini", "gemini-3-flash-preview", true],
      ["gemini", "gemini-2.5-flash", false],
      ["gemini", "custom-model", false],
      ["openai", "gemini-3.8-flash", false],
    ]) {
      const fixture = reportFixture({ provider, model, finishReason: "stop" });
      const result = await fixture.run();
      assert.equal(result.summaryAnalysis, fixture.texts[0]);
      assert.equal(result.annotationSegments[0].content, "user: Hello");
      assert.equal(result.detailedFeedback, result.segmentedAnalysis);
      assert.deepEqual(fixture.calls.map(({ options }) => options.modelSettings.maxOutputTokens), provider === "gemini" ? [4096, 4096] : [2048 + 4096, 1536 + 4096]);
      assert.ok(fixture.calls.every(({ options }) => !options.memory));
      for (const { options } of fixture.calls) {
        assert.deepEqual(options.providerOptions, lowThinking
          ? { google: { thinkingConfig: { thinkingLevel: "low" } } }
          : undefined);
      }
    }
    const legacy = reportFixture({ finishReason: undefined });
    // Missing metadata from older adapters is not proof of truncation.
    const result = await legacy.run();
    assert.equal(result.summaryAnalysis, legacy.texts[0]);
  });

  test("length-truncated output never becomes a completed report", async () => {
    for (const provider of ["gemini", "openai"]) {
      for (const truncatedStage of [0, 1]) {
        const fixture = reportFixture({ provider, truncatedStage });
        await assert.rejects(fixture.run(), /The report could not be generated/);
        assert.equal(fixture.calls.length, 2);
      }
    }
  });

  for (const withMemory of [false, true]) {
    test(`provider failures survive and subsequent requests recover (memory=${withMemory})`, () => {
      const result = spawnSync(
        process.execPath,
        [file, "--runtime-child", ...(withMemory ? ["--memory"] : [])],
        { cwd: root, encoding: "utf8", timeout: 20000 },
      );
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const observed = JSON.parse(result.stdout.trim().split("\n").at(-1));
      assert.deepEqual(observed, {
        survived: true,
        withMemory,
        networkCalls: 0,
        modelCalls: 8,
      });
    });
  }

  test("SSE sanitizes unexpected exceptions and does not signal completion", async () => {
    const { createSSEStream } = loadBackendSource(
      "src/backend/src/utils/streamUtils.ts",
    );
    const response = createSSEStream(async () => {
      throw new Error("private transcript and secret credential");
    });
    const sse = await response.text();
    assert.match(sse, /"code":"PROVIDER_UNAVAILABLE"/);
    assert.doesNotMatch(sse, /private|secret|credential|event: done/);
  });

  test("disconnecting during generation contains a later failure", async () => {
    const { createSSEStream } = loadBackendSource(
      "src/backend/src/utils/streamUtils.ts",
    );
    let finish;
    const generation = new Promise((resolve) => {
      finish = resolve;
    });
    const response = createSSEStream(async () => {
      await generation;
      throw new Error("late provider failure");
    });
    await response.body.cancel();
    finish();
    await new Promise((resolve) => setImmediate(resolve));
  });

  test("text chunks survive Cedar's JSON parsing of every data line", async () => {
    const { handleTextStream } = loadBackendSource(
      "src/backend/src/utils/streamUtils.ts",
    );
    // Each of these broke as raw `data:` text: dropped, turned into a number, or unquoted.
    const chunks = ["I'm", " done", " 2", " true", ' "fine"', " null", "\nNext", ""];
    let sse = "";
    const decoder = new TextDecoder();
    const controller = { enqueue: (bytes) => (sse += decoder.decode(bytes)) };
    for (const chunk of chunks) await handleTextStream(chunk, controller);
    const events = sse.split("\n\n").filter(Boolean);
    // Cedar's content branch: a JSON object with a non-empty string `content` and no `type`.
    const parsed = events.map((event) => JSON.parse(event.replace(/^data:/, "")));
    assert.ok(parsed.every((data) => typeof data.content === "string" && data.content && !data.type));
    assert.equal(parsed.map((data) => data.content).join(""), chunks.join(""));
  });
}
