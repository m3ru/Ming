import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { backendRequire, loadBackendSource, loadReportWorkflow, loadReportService, root } from "./backend-runtime.mjs";
import { scenarioFixture } from "./scenario-fixture.mjs";

async function exerciseRouter() {
  const output = console.log.bind(console);
  for (const method of ["log", "error", "warn", "info", "debug"])
    console[method] = () => {};
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls++;
    throw new Error("Network is disabled.");
  };
  delete process.env.OPENAI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  process.env.MING_TEXT_PROVIDER = "openai";
  delete process.env.MING_VOICE_PROVIDER;
  delete process.env.MASTRA_CLOUD_ACCESS_TOKEN;
  const token = "synthetic-gateway-secret-at-least-32-characters";
  const { Agent } = backendRequire("@mastra/core/agent");
  const { Memory } = backendRequire("@mastra/memory");
  const { LibSQLStore } = backendRequire("@mastra/libsql");
  const { createHonoServer } = backendRequire("@mastra/deployer/server");
  const storage = new LibSQLStore({ url: ":memory:" });
  const memory = new Memory({ storage, options: { lastMessages: 20 } });
  let modelCalls = 0;
  const model = {
    specificationVersion: "v2",
    provider: "synthetic",
    modelId: "synthetic",
    supportedUrls: {},
    doGenerate: async () => {
      modelCalls++;
      return {
        content: [{ type: "text", text: "Synthetic report text" }],
        finishReason: "stop",
        usage: { inputTokens: 1, outputTokens: 1 },
        warnings: [],
      };
    },
    doStream: async (options) => {
      modelCalls++;
      const isAnnotation = options.prompt.some((message) => message.role === "user" && Array.isArray(message.content) && message.content.some((part) => part.type === "text" && part.text.startsWith('{"lines":')));
      const isScenario = options.prompt.some((message) => JSON.stringify(message).includes("Design the next workplace communication practice with Bart"));
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            controller.enqueue({ type: "text-start", id: "text-1" });
            controller.enqueue({
              type: "text-delta",
              id: "text-1",
              delta: isScenario ? JSON.stringify(scenarioFixture) : isAnnotation ? JSON.stringify({ segments: [{ title: "Conversation", startLine: 0, highlights: [] }] }) : "Synthetic reply",
            });
            controller.enqueue({ type: "text-end", id: "text-1" });
            controller.enqueue({
              type: "finish",
              finishReason: "stop",
              usage: { inputTokens: 1, outputTokens: 1 },
            });
            controller.close();
          },
        }),
      };
    },
  };
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
        ...(name === "defaultAgent" ? { memory } : {}),
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
  const security = loadBackendSource("src/backend/src/lib/security.ts", {
    "../mastra/agents/defaultAgent": { defaultAgent: agents.defaultAgent },
  });
  const voice = loadBackendSource("src/backend/src/lib/voice.ts", { "./prompts": loadBackendSource("src/backend/src/lib/prompts.ts") });
  const deepgram = loadBackendSource("src/backend/src/lib/deepgramVoice.ts", { "./voice": voice });
  const providers = loadBackendSource("src/backend/src/lib/providers.ts");
  let deepgramTurns = 0;
  let voiceSessions = 0;
  let voiceGenerations = 0;
  const saved = [];
  const liveVoice = voice.createLiveVoiceService({
    apiKey: () => "synthetic-key",
    request: async () =>
      Response.json({
        session: { id: "live-" + ++voiceSessions },
        transport: { sdp: "answer" },
      }),
    generate: async () => {
      voiceGenerations++;
      return "Synthetic delegated reply";
    },
    save: async (messages, scope) => saved.push({ messages, scope }),
  });
  const chat = loadBackendSource(
    "src/backend/src/mastra/workflows/chatWorkflow.ts",
    {
      ...agentMocks,
      "../../utils/streamUtils": utils,
      "../../lib/prompts": loadBackendSource("src/backend/src/lib/prompts.ts"),
      "./chatWorkflowTypes": loadBackendSource(
        "src/backend/src/mastra/workflows/chatWorkflowTypes.ts",
      ),
    },
  );
  const feedback = loadReportWorkflow(agentMocks, providers);
  const scenario = loadBackendSource(
    "src/backend/src/mastra/workflows/scenarioPipelineWorkflow.ts",
    { ...agentMocks, "../../lib/scenarioSchema": loadBackendSource("src/backend/src/lib/scenarioSchema.ts"), "../../lib/providers": loadBackendSource("src/backend/src/lib/providers.ts") },
  );
  const registry = loadBackendSource("src/backend/src/mastra/apiRegistry.ts", {
    "./workflows/chatWorkflow": chat,
    "./reportService": loadReportService(feedback, providers, security),
    "./workflows/scenarioPipelineWorkflow": scenario,
    "../utils/streamUtils": utils,
    "../lib/security": security,
    "../lib/voice": voice,
    "./liveVoice": { liveVoice },
    "./deepgramVoice": { deepgramVoice: { turn: async () => {
      deepgramTurns++;
      return { status: "success", persisted: true, messages: [] };
    } } },
    "../lib/deepgramVoice": deepgram,
    "./models": providers,
    "./sentiment": { scoreSentiment: async () => ({ score: 0, magnitude: 0 }) },
    "../lib/sentiment": loadBackendSource("src/backend/src/lib/sentiment.ts"),
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
  const app = await createHonoServer(mastra, { isDev: true, tools: {} });
  const headers = (identity = "owner-a") => ({
    "Content-Type": "application/ming+json",
    "x-ming-gateway-token": token,
    "x-ming-user-id": identity,
  });
  const request = (path, body, identity = "owner-a", extra = {}) =>
    app.request(path, {
      method: "POST",
      headers: { ...headers(identity), ...extra },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  const chatBody = {
    prompt: "Hello",
    threadId: "owned-thread",
    resourceId: "forged-resource",
    additionalContext: { chatType: { data: "scenario" } },
  };
  for (const missing of [undefined, "short", " ".repeat(32)]) {
    if (missing === undefined) delete process.env.MING_BACKEND_TOKEN;
    else process.env.MING_BACKEND_TOKEN = missing;
    assert.equal((await request("/chat/stream", chatBody)).status, 503);
  }
  process.env.MING_BACKEND_TOKEN = token;
  assert.equal(
    (await app.request("/chat/stream", { method: "POST", body: "{}" })).status,
    401,
  );
  assert.equal(
    (
      await request("/chat/stream", chatBody, "owner-a", {
        "x-ming-gateway-token": "wrong",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await request("/chat/stream", chatBody, "owner-a", {
        "x-ming-user-id": "",
      })
    ).status,
    401,
  );
  assert.equal(modelCalls, 0);

  // Exercise actual mounted APIs in development mode, including discovery,
  // memory, workflows, agents, A2A, docs, and encoded route variants.
  const forbidden = [
    "/api",
    "/api/agents",
    "/api/agents/defaultAgent/generate",
    "/api/memory/threads",
    "/api/memory/threads/owned-thread/messages",
    "/api/workflows/feedbackOrchestratorWorkflow/create-run",
    "/api/workflows/feedbackOrchestratorWorkflow/start",
    "/api/tools",
    "/api/vector",
    "/api/logs",
    "/api/observability",
    "/openapi.json",
    "/swagger-ui",
    "/a2a/defaultAgent",
    "/.well-known/defaultAgent/agent-card.json",
    "/%61pi/agents",
    "/api%2fagents",
    "/api//memory/threads",
  ];
  for (const path of forbidden) {
    for (const method of ["GET", "POST", "DELETE", "OPTIONS"]) {
      const res = await app.request(path, { method, headers: headers() });
      assert.equal(res.status, 404, `${method} ${path}`);
      assert.doesNotMatch(
        await res.text(),
        /instructions|Synthetic report|OPENAI_API_KEY/,
      );
    }
  }
  assert.equal(modelCalls, 0);
  assert.equal((await request("/chat/stream", chatBody)).status, 503);
  process.env.OPENAI_API_KEY = "synthetic-not-a-real-key";
  assert.equal(
    (await request("/chat/stream", { ...chatBody, maxTokens: 10000000 }))
      .status,
    400,
  );
  assert.equal(
    (await request("/chat/stream", { ...chatBody, prompt: "a".repeat(16001) }))
      .status,
    400,
  );
  const reservedId =
    security.analysisThread("owned-thread", "owner-a") + "_analyzer";
  for (const [path, body] of [
    ["/chat/stream", { ...chatBody, threadId: reservedId }],
    ["/feedback", { threadId: reservedId, transcript: "Synthetic transcript" }],
    [
      "/scenario-next",
      { threadId: reservedId, analysis: "Synthetic analysis" },
    ],
    [
      "/voice/session",
      {
        sdp: "offer",
        threadId: reservedId,
        resourceId: "owner-a",
        context: {},
        messages: [],
      },
    ],
  ])
    assert.equal((await request(path, body)).status, 400, path);
  assert.equal(
    (
      await request(
        "/sentiment",
        JSON.stringify({ text: "x".repeat(security.REQUEST_BYTE_LIMIT) }),
      )
    ).status,
    413,
  );
  assert.equal(
    (await request("/sentiment", { text: "ok", oversized: Array(257).fill(0) }))
      .status,
    400,
  );
  let nested = {};
  for (let i = 0; i < 22; i++) nested = { child: nested };
  assert.equal(
    (await request("/sentiment", { text: "ok", nested })).status,
    400,
  );
  assert.equal(modelCalls, 0);

  const deepgramBody = {
    turnId: "9a6e8f18-feb9-481f-b9e8-cb555372e485",
    threadId: "owned-thread",
    audioBase64: Buffer.alloc(300 * 1024, 1).toString("base64"),
    mimeType: "audio/webm;codecs=opus", context: {}, messages: [],
  };
  assert.equal((await request("/voice/deepgram/turn", deepgramBody)).status, 404);
  process.env.MING_VOICE_PROVIDER = "deepgram";
  delete process.env.DEEPGRAM_API_KEY;
  assert.equal((await request("/voice/deepgram/turn", deepgramBody)).status, 503);
  assert.equal(deepgramTurns, 0);
  process.env.DEEPGRAM_API_KEY = "synthetic-deepgram";
  assert.equal((await request("/voice/deepgram/turn", deepgramBody)).status, 200);
  assert.equal(deepgramTurns, 1);
  assert.equal((await request("/voice/deepgram/turn", deepgramBody, "attacker-b")).status, 403);
  assert.equal(deepgramTurns, 1);
  assert.equal((await request("/voice/deepgram/turn", { ...deepgramBody, extra: "x".repeat(security.DEEPGRAM_REQUEST_BYTE_LIMIT) })).status, 413);
  assert.equal((await request("/voice/deepgram/turn", { ...deepgramBody, nested })).status, 400);
  assert.equal((await request("/voice/deepgram/turn", deepgramBody, "owner-a", { "Content-Type": "audio/webm" })).status, 400);
  assert.equal((await request("/voice/sync", { extra: deepgramBody.audioBase64 })).status, 413);
  delete process.env.MING_VOICE_PROVIDER;

  const accepted = await request("/chat/stream", chatBody);
  assert.equal(accepted.status, 200);
  assert.match(await accepted.text(), /Synthetic reply/);
  assert.equal(
    (await memory.getThreadById({ threadId: "owned-thread" })).resourceId,
    "owner-a",
  );
  const afterOwner = modelCalls;
  for (const [path, body] of [
    ["/chat/stream", chatBody],
    [
      "/feedback",
      {
        threadId: "owned-thread",
        transcript: "user: Hello\nbart: Hello",
        resourceId: "owner-a",
      },
    ],
    [
      "/scenario-next",
      {
        threadId: "owned-thread",
        analysis: "Synthetic analysis",
        resourceId: "owner-a",
      },
    ],
    [
      "/voice/session",
      {
        sdp: "offer",
        threadId: "owned-thread",
        resourceId: "owner-a",
        context: {},
        messages: [],
      },
    ],
  ])
    assert.equal((await request(path, body, "attacker-b")).status, 403, path);
  assert.equal(modelCalls, afterOwner);
  assert.equal(voiceSessions, 0);
  // Claims for a missing shared ID race, but exactly one owner gets it.
  const race = await Promise.all([
    request(
      "/chat/stream",
      { ...chatBody, threadId: "raced-thread" },
      "race-a",
    ),
    request(
      "/chat/stream",
      { ...chatBody, threadId: "raced-thread" },
      "race-b",
    ),
  ]);
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 403]);
  for (const response of race) await response.text();

  const report = await request("/feedback", {
    threadId: "owned-thread",
    transcript: "user: Hello\nbart: Hello",
  });
  assert.equal(report.status, 200);
  const reportResult = await report.json();
  assert.equal(reportResult.status, "success");
  assert.equal(reportResult.result.summaryAnalysis, "Synthetic reply");
  assert.deepEqual(Object.keys(reportResult.result).sort(), [
    "annotationSegments",
    "annotationStatus",
    "detailedFeedback",
    "segmentedAnalysis",
    "summaryAnalysis",
  ]);
  const next = await request("/scenario-next", {
    threadId: "owned-thread",
    analysis: "Synthetic analysis",
  });
  assert.equal(next.status, 200);
  assert.deepEqual(await next.json(), { status: "success", result: { scenario: scenarioFixture } });

  // The selected text key gates every text workflow, independently from the
  // OpenAI key required to open the existing live voice transport.
  for (const provider of ["gemini", "openai"]) {
    process.env.MING_TEXT_PROVIDER = provider;
    if (provider === "gemini") {
      delete process.env.GEMINI_API_KEY;
      process.env.OPENAI_API_KEY = "synthetic-openai";
    } else {
      delete process.env.OPENAI_API_KEY;
      process.env.GEMINI_API_KEY = "synthetic-gemini";
    }
    const scopeId = "config-" + provider;
    const textRequests = [
      ["/chat/stream", { ...chatBody, threadId: scopeId }],
      ["/sentiment", { text: "A calm request" }],
      ["/feedback", { threadId: scopeId, transcript: "user: Hello\nbart: Hello" }],
      ["/scenario-next", { threadId: scopeId, analysis: "Synthetic analysis" }],
    ];
    for (const [path, body] of textRequests)
      assert.equal((await request(path, body, scopeId)).status, 503, provider + " missing selected key " + path);
    if (provider === "gemini") {
      process.env.GEMINI_API_KEY = "synthetic-gemini";
      delete process.env.OPENAI_API_KEY;
      assert.equal((await request("/voice/session", { sdp: "offer", threadId: scopeId, context: {}, messages: [] }, scopeId)).status, 503);
    } else process.env.OPENAI_API_KEY = "synthetic-openai";
    for (const [path, body] of textRequests) {
      const response = await request(path, body, scopeId);
      assert.equal(response.status, 200, provider + " configured " + path);
      await response.text();
    }
  }
  process.env.MING_TEXT_PROVIDER = "openai";

  const offered = await request("/voice/session", {
    sdp: "offer",
    threadId: "owned-thread",
    resourceId: "attacker-b",
    context: {},
    messages: [],
  });
  assert.equal(offered.status, 200);
  const session = await offered.json();
  const voiceHeaders = { Authorization: "Bearer " + session.token };
  const voiceMessage = {
    id: "voice-" + session.sessionId + "-user-0",
    role: "user",
    content: "Hello",
    createdAt: new Date().toISOString(),
  };
  const sync = { sessionId: session.sessionId, messages: [voiceMessage] };
  const delegate = { ...sync, delegationId: "task-1", context: {} };
  for (const [path, body] of [
    ["/voice/sync", sync],
    ["/voice/delegate", delegate],
    ["/voice/heartbeat", { sessionId: session.sessionId }],
    ["/voice/end", { sessionId: session.sessionId }],
  ]) {
    assert.equal(
      (await request(path, body, "attacker-b", voiceHeaders)).status,
      403,
      path,
    );
  }
  assert.equal(saved.length, 0);
  assert.equal(voiceGenerations, 0);
  assert.equal(
    (
      await request("/voice/sync", sync, "owner-a", {
        Authorization: "Bearer wrong",
      })
    ).status,
    403,
  );
  assert.equal(
    (await request("/voice/sync", sync, "owner-a", voiceHeaders)).status,
    200,
  );
  assert.equal(saved[0].scope.resourceId, "owner-a");
  assert.equal(
    (await request("/voice/delegate", delegate, "owner-a", voiceHeaders))
      .status,
    200,
  );
  assert.equal(voiceGenerations, 1);
  assert.equal(
    (await request("/voice/heartbeat", { sessionId: session.sessionId }, "owner-a", voiceHeaders)).status,
    200,
  );
  assert.equal(
    (
      await request(
        "/voice/end",
        { sessionId: session.sessionId },
        "owner-a",
        voiceHeaders,
      )
    ).status,
    200,
  );
  assert.equal(
    (await request("/voice/sync", sync, "owner-a", voiceHeaders)).status,
    200,
  );
  assert.equal(
    (await request("/voice/heartbeat", { sessionId: session.sessionId }, "owner-a", voiceHeaders)).status,
    409,
  );
  assert.equal(
    (await request("/voice/delegate", delegate, "owner-a", voiceHeaders)).status,
    409,
  );
  assert.equal(
    (
      await request(
        "/voice/sync",
        { ...sync, messages: Array(129).fill(voiceMessage) },
        "owner-a",
        voiceHeaders,
      )
    ).status,
    400,
  );

  // Cost controls apply even to valid gateway users and never touch providers.
  // Zero-unit reservations test concurrency alone, leaving the hourly budget untouched.
  const releases = [
    security.reserveGeneration("capacity-a", 0),
    security.reserveGeneration("capacity-a", 0),
    security.reserveGeneration("capacity-a", 0),
    security.reserveGeneration("capacity-a", 0),
  ];
  assert.throws(
    () => security.reserveGeneration("capacity-a", 0),
    (e) => e.status === 429,
  );
  // The fifth concurrent generation is refused for any identity, not only the busy one.
  assert.throws(
    () => security.reserveGeneration("capacity-b", 0),
    (e) => e.status === 429,
  );
  releases.forEach((release) => {
    release();
    release();
  });
  // Released slots are reusable; releasing twice did not double-free.
  security.reserveGeneration("capacity-b", 0)();
  // Every visitor shares one identity, so one identity may spend the whole 600-unit
  // hour. Earlier requests in this test already used some of it: spend in big chunks,
  // then drain the rest (at most 15 successful reservations, under the 20/minute cap).
  let spent = 0;
  for (const units of [75, 75, 75, 75, 75, 75, 75, 75, 64, 32, 16, 8, 4, 2, 1]) {
    try {
      security.reserveGeneration("hour-quota", units)();
      spent += units;
    } catch (e) {
      assert.equal(e.status, 429);
    }
  }
  assert.ok(spent > 120, "one identity is no longer capped at 120 units an hour");
  assert.throws(
    () => security.reserveGeneration("hour-quota"),
    (e) => e.status === 429,
  );
  const safe = await request("/sentiment", { text: "ok" }, "hour-quota");
  assert.equal(safe.status, 429);
  assert.doesNotMatch(await safe.text(), new RegExp(token));
  assert.equal(networkCalls, 0);
  output(
    JSON.stringify({
      passed: true,
      networkCalls,
      forbiddenChecks: forbidden.length * 4,
    }),
  );
  process.exit(0);
}

if (process.argv.includes("--router-child")) {
  await exerciseRouter();
} else {
  test("real Mastra router enforces gateway, ownership, blocked built-ins and quotas without provider calls", () => {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(import.meta.url), "--router-child"],
      { cwd: root, encoding: "utf8", timeout: 30000 },
    );
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(
      JSON.parse(result.stdout.trim().split("\n").at(-1)).passed,
      true,
    );
  });

  test("voice capacity reserves concurrent offers and end releases slots", async () => {
    const { createLiveVoiceService } = loadBackendSource(
      "src/backend/src/lib/voice.ts",
      { "./prompts": loadBackendSource("src/backend/src/lib/prompts.ts") },
    );
    let releaseProvider;
    const providerGate = new Promise((resolve) => {
      releaseProvider = resolve;
    });
    let offers = 0;
    const service = createLiveVoiceService({
      apiKey: () => "synthetic",
      generate: async () => "reply",
      save: async () => {},
      request: async () => {
        const id = "session-" + ++offers;
        await providerGate;
        return Response.json({ session: { id }, transport: { sdp: "answer" } });
      },
    });
    const offer = {
      sdp: "offer",
      threadId: "owned",
      resourceId: "owner",
      messages: [],
      context: {},
    };
    const first = service.create(offer, "owner");
    const second = service.create(offer, "owner");
    await assert.rejects(
      service.create(offer, "owner"),
      (error) => error.status === 429,
    );
    assert.equal(offers, 2);
    releaseProvider();
    const sessions = await Promise.all([first, second]);
    await service.end(sessions[0].sessionId, sessions[0].token, "owner");
    const replacement = await service.create(offer, "owner");
    assert.equal(replacement.sessionId, "session-3");
    await assert.rejects(
      service.end(sessions[1].sessionId, sessions[1].token, "attacker"),
      (error) => error.status === 403,
    );
    const failing = createLiveVoiceService({
      apiKey: () => "synthetic",
      generate: async () => "",
      save: async () => {},
      request: async () => {
        throw new Error("synthetic failure");
      },
    });
    for (let i = 0; i < 3; i++)
      await assert.rejects(failing.create(offer, "owner"), /synthetic failure/);

    let releaseGlobal;
    const globalGate = new Promise((resolve) => {
      releaseGlobal = resolve;
    });
    let globalOffers = 0;
    const globallyBounded = createLiveVoiceService({
      apiKey: () => "synthetic",
      generate: async () => "reply",
      save: async () => {},
      request: async () => {
        const id = "global-session-" + ++globalOffers;
        await globalGate;
        return Response.json({ session: { id }, transport: { sdp: "answer" } });
      },
    });
    const pending = Array.from({ length: 100 }, (_, i) => {
      const identity = "owner-" + i;
      return globallyBounded.create(
        { ...offer, resourceId: identity },
        identity,
      );
    });
    await assert.rejects(
      globallyBounded.create({ ...offer, resourceId: "extra" }, "extra"),
      (error) => error.status === 429,
    );
    assert.equal(globalOffers, 100);
    releaseGlobal();
    await Promise.all(pending);
  });
}
