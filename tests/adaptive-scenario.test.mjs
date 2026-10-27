import assert from "node:assert/strict";
import { test } from "node:test";
import { backendRequire, loadBackendSource } from "./backend-runtime.mjs";
import { scenarioFixture } from "./scenario-fixture.mjs";

const schema = loadBackendSource("src/backend/src/lib/scenarioSchema.ts");
const providers = loadBackendSource("src/backend/src/lib/providers.ts");
const prompts = loadBackendSource("src/backend/src/lib/prompts.ts");

function workflowFixture({ provider = "gemini", model = "gemini-3.8-flash", result = {}, generate } = {}) {
  const stages = [];
  const calls = [];
  const workflow = { then(step) { stages.push(step); return this; }, commit() { return this; } };
  const source = loadBackendSource("src/backend/src/mastra/workflows/scenarioPipelineWorkflow.ts", {
    "@mastra/core/workflows": { createStep: (step) => step, createWorkflow: () => workflow },
    "../../lib/scenarioSchema": schema,
    "../../lib/providers": { resolveTextProvider: () => ({ provider, model }) },
    "../agents/scenarioCreateAgent": { scenarioCreateAgent: { async generateVNext(messages, options) {
      calls.push({ messages, options });
      if (generate) return generate(messages, options);
      return { object: scenarioFixture, text: JSON.stringify(scenarioFixture), finishReason: "stop", ...result };
    } } },
  });
  return { ...source, stages, calls, async run(input) {
    let inputData = source.ScenarioPipelineInputSchema.parse(input ?? { analysis: "Ask open questions before proposing a solution." });
    for (const step of stages) inputData = await step.execute({ inputData });
    return inputData;
  } };
}

test("shared schema accepts a complete scenario and strips legacy backend-only NPC instructions", () => {
  assert.deepEqual(schema.scenarioSchema.parse(scenarioFixture), scenarioFixture);
  const legacy = structuredClone(scenarioFixture);
  legacy.npcs[0].role_llm = "Legacy role prompt";
  legacy.npcs[0].personality_llm = "Legacy personality prompt";
  assert.deepEqual(schema.scenarioSchema.parse(legacy), scenarioFixture);
  assert.equal(schema.scenarioSchema.safeParse({ ...scenarioFixture, npcs: [{ ...scenarioFixture.npcs[0], pfp: "/businessman.png" }] }).success, true);
  const { Scenarios } = loadBackendSource("src/backend/src/lib/scenarios.ts");
  for (const builtIn of Object.values(Scenarios)) assert.equal(schema.scenarioSchema.safeParse(builtIn).success, true);
});

test("shared schema rejects partial, empty, oversized, unsafe and malformed scenarios", () => {
  const invalid = [
    "<scenario_title>Partial XML</scenario_title>", null, {},
    { ...scenarioFixture, title: "   " },
    { ...scenarioFixture, title: "Unknown" },
    { ...scenarioFixture, goal: "x".repeat(2501) },
    { ...scenarioFixture, npcs: [] },
    { ...scenarioFixture, npcs: [{ ...scenarioFixture.npcs[0], pfp: "javascript:alert(1)" }] },
    { ...scenarioFixture, npcs: [{ ...scenarioFixture.npcs[0], pfp: "//untrusted.invalid/photo" }] },
    { ...scenarioFixture, documents: [] },
    { ...scenarioFixture, documents: [{ ...scenarioFixture.documents[0], content: [] }] },
    { ...scenarioFixture, documents: [{ ...scenarioFixture.documents[0], content: [{ format: "html", content: "text" }] }] },
    { ...scenarioFixture, documents: [{ ...scenarioFixture.documents[0], content: [{ format: "plain", content: " " }] }] },
  ];
  for (const value of invalid) assert.equal(schema.scenarioSchema.safeParse(value).success, false);
});

test("one generation uses actual feedback and previous scenario with provider-specific output budgets", async () => {
  for (const [provider, model, lowThinking] of [
    ["gemini", "gemini-3.8-flash", true],
    ["gemini", "gemini-3-flash-preview", true],
    ["gemini", "gemini-2.5-flash", false],
    ["openai", "gpt-5.4-mini", false],
  ]) {
    const fixture = workflowFixture({ provider, model });
    const input = { analysis: "Strength: specific examples. Weakness: no exploratory questions before solutions.", threadId: "analysis-owned", resourceId: "owner", additionalContext: { previousScenario: scenarioFixture } };
    assert.deepEqual(await fixture.run(input), { scenario: scenarioFixture });
    assert.equal(fixture.stages.length, 1);
    assert.equal(fixture.calls.length, 1);
    const { messages, options } = fixture.calls[0];
    assert.ok(messages[0].includes(input.analysis));
    assert.ok(messages[0].includes(JSON.stringify(input.additionalContext)));
    assert.match(messages[0], /one or two specific weaknesses actually identified/);
    assert.match(messages[0], /observable success criteria/);
    assert.equal(options.modelSettings.maxOutputTokens, provider === "gemini" ? 8192 : 6144);
    assert.equal(options.output.safeParse(scenarioFixture).success, true);
    assert.ok(options.abortSignal instanceof AbortSignal);
    assert.deepEqual(options.providerOptions, lowThinking ? { google: { thinkingConfig: { thinkingLevel: "low" } } } : undefined);
    assert.equal(options.memory, undefined);
  }
});

test("truncated, malformed and failed generations never return a fallback practice", async () => {
  for (const result of [
    { finishReason: "length" }, { finishReason: "content-filter" }, { finishReason: undefined },
    { error: "private provider details" }, { tripwire: true },
    { object: undefined, text: '{"title":"truncated' },
    { text: JSON.stringify(scenarioFixture).slice(0, -1) },
    { text: "```json\n" + JSON.stringify(scenarioFixture) + "\n```" },
    { object: "raw XML or JSON string" }, { object: { title: "Only a title" } },
    { object: { ...scenarioFixture, npcs: [] } },
    { object: { ...scenarioFixture, npcs: [{ ...scenarioFixture.npcs[0], name: "Bill" }] } },
    { object: { ...scenarioFixture, npcs: [{ ...scenarioFixture.npcs[0], pfp: "https://example.com/different-face.jpg" }] } },
  ]) {
    const fixture = workflowFixture({ result });
    await assert.rejects(fixture.run(), (error) => {
      assert.equal(error.message, "The scenario could not be generated. Try again.");
      assert.equal(error.cause, undefined);
      return true;
    });
    assert.equal(fixture.calls.length, 1);
  }
  await assert.rejects(workflowFixture({ generate: async () => { throw Error("synthetic-key and private feedback"); } }).run(), (error) => {
    assert.doesNotMatch(error.message, /synthetic-key|private feedback/);
    return true;
  });
});

test("bounded request input rejects invalid feedback before contacting a model", async () => {
  for (const input of [{ analysis: " " }, { analysis: "x".repeat(96001) }, { analysis: "Feedback", additionalContext: "wrong type" }, { analysis: "Feedback", additionalContext: { text: "x".repeat(96000) } }]) {
    const fixture = workflowFixture();
    await assert.rejects(fixture.run(input));
    assert.equal(fixture.calls.length, 0);
  }
});

test("installed Mastra structured-output runtime produces a validated scenario without provider calls", async () => {
  const { Agent } = backendRequire("@mastra/core/agent");
  const calls = [];
  let outputText = JSON.stringify(scenarioFixture);
  let finishReason = "stop";
  const model = {
    specificationVersion: "v2", provider: "synthetic", modelId: "synthetic", supportedUrls: {},
    async doStream(options) {
      calls.push(options);
      return { stream: new ReadableStream({ start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        controller.enqueue({ type: "text-start", id: "scenario" });
        controller.enqueue({ type: "text-delta", id: "scenario", delta: outputText });
        controller.enqueue({ type: "text-end", id: "scenario" });
        controller.enqueue({ type: "finish", finishReason, usage: { inputTokens: 1, outputTokens: 100 } });
        controller.close();
      } }) };
    },
  };
  const agent = new Agent({ name: "synthetic-scenario", instructions: "Return the requested JSON object.", model });
  const fixture = workflowFixture({ generate: (messages, options) => agent.generateVNext(messages, options) });
  assert.deepEqual(await fixture.run(), { scenario: scenarioFixture });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].prompt.some((message) => JSON.stringify(message).includes("goalForAnalyzer")));
  outputText = JSON.stringify(scenarioFixture).slice(0, -1);
  await assert.rejects(fixture.run(), /The scenario could not be generated/);
  outputText = JSON.stringify(scenarioFixture);
  finishReason = "length";
  await assert.rejects(fixture.run(), /The scenario could not be generated/);
});

test("scenario role-play uses current NPC, documents and learner authority for every Cedar context shape", () => {
  for (const details of [scenarioFixture, { data: scenarioFixture }, { data: { scenarioDetails: scenarioFixture } }]) {
    const prompt = prompts.scenarioRoleplayPrompt({ scenarioDetails: details });
    assert.ok(prompt.includes(scenarioFixture.userRole));
    assert.ok(prompt.includes(scenarioFixture.npcs[0].personality));
    assert.ok(prompt.includes(scenarioFixture.npcs[0].scenarioSpecificInfo));
    assert.ok(prompt.includes(scenarioFixture.documents[0].content[1].content));
    assert.match(prompt, /Play only this NPC/);
    assert.doesNotMatch(prompt, /recently your performance has declined due to personal family issues/);
  }
  assert.equal(prompts.scenarioRoleplayPrompt({}), prompts.bartPrompt);
  assert.equal(prompts.scenarioRoleplayPrompt({ scenarioDetails: { data: { title: "Partial" } } }), prompts.bartPrompt);
});

function routerFixture(result) {
  const workflow = workflowFixture();
  let generated = 0;
  let claimed = 0;
  const z = backendRequire("zod").z;
  class AccessError extends Error {}
  const registry = loadBackendSource("src/backend/src/mastra/apiRegistry.ts", {
    "@mastra/core/server": { registerApiRoute: (path, options) => ({ path, ...options }) },
    "./workflows/chatWorkflow": { ChatInputSchema: z.object({}), chatWorkflow: {} },
    "./reportService": {},
    "./workflows/scenarioPipelineWorkflow": { ...workflow, scenarioPipelineWorkflow: { createRunAsync: async () => ({ start: async () => { generated++; return result; } }) } },
    "../utils/streamUtils": {},
    "./liveVoice": { liveVoice: {} },
    "./deepgramVoice": { deepgramVoice: {} },
    "../lib/deepgramVoice": { DeepgramVoiceError: class extends Error {} },
    "./models": { isTextConfigured: () => true },
    "./sentiment": {}, "../lib/sentiment": {},
    "../lib/voice": { VoiceError: class extends Error {} },
    "../lib/security": { AccessError, threadIdSchema: z.string().min(1), trustedIdentity: () => "owner", reserveGeneration: () => () => {}, claimThread: async () => { claimed++; }, analysisThread: (id) => "analysis-" + id },
  });
  const route = registry.apiRoutes.find((item) => item.path === "/scenario-next");
  return { get generated() { return generated; }, get claimed() { return claimed; }, request: (body) => route.handler({ req: { json: async () => body }, json: (body, status = 200) => Response.json(body, { status }) }) };
}

test("scenario API exposes only a validated scenario object and safe retryable failure", async () => {
  const valid = routerFixture({ status: "success", result: { scenario: scenarioFixture, private: "hidden" } });
  const response = await valid.request({ analysis: "Ask exploratory questions.", threadId: "owned" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "success", result: { scenario: scenarioFixture } });
  assert.equal(valid.claimed, 1);
  for (const result of [{ status: "failed", error: "synthetic-key and feedback" }, { status: "success", result: { scenario: "XML string", prompts: "raw", reports: "raw" } }, { status: "success", result: { scenario: { ...scenarioFixture, documents: [] } } }]) {
    const invalid = routerFixture(result);
    const failed = await invalid.request({ analysis: "Actual feedback", threadId: "owned" });
    assert.equal(failed.status, 502);
    const body = await failed.json();
    assert.equal(body.status, "failed");
    assert.equal(body.result, undefined);
    assert.doesNotMatch(JSON.stringify(body), /synthetic-key|XML string|Actual feedback/);
  }
  const invalid = routerFixture({});
  assert.equal((await invalid.request({ analysis: " ", threadId: "owned" })).status, 400);
  assert.equal(invalid.generated, 0);
  assert.equal(invalid.claimed, 0);
});

test("typed chat and both voice text adapters use the selected scenario instead of the fixed review", async () => {
  const context = { chatType: { data: "scenario" }, scenarioDetails: { data: scenarioFixture } };
  const captures = [];
  const agentMock = { Agent: class {
    async generateVNext(messages) { captures.push(messages[0].content); return { text: "That is fucking bullshit!" }; }
  } };
  const voice = loadBackendSource("src/backend/src/lib/voice.ts", { "./prompts": prompts });
  const deepgram = loadBackendSource("src/backend/src/mastra/deepgramVoice.ts", {
    "@mastra/core/agent": agentMock,
    "../lib/deepgramVoice": { createDeepgramVoiceService: (dependencies) => dependencies },
    "../lib/prompts": prompts,
    "../lib/providers": providers,
    "../lib/security": {},
    "../lib/voice": voice,
    "./agents/defaultAgent": {},
    "./models": { isTextConfigured: () => true, textModel: {} },
  });
  const live = loadBackendSource("src/backend/src/mastra/liveVoice.ts", {
    "@mastra/core/agent": agentMock,
    "../lib/voice": { ...voice, createLiveVoiceService: (dependencies) => dependencies },
    "../lib/prompts": prompts,
    "../lib/providers": providers,
    "./agents/defaultAgent": {},
    "./models": { textModel: {} },
  });
  assert.equal(await deepgram.deepgramVoice.generate([], context, new AbortController().signal), "That is BEEP BEEP!");
  assert.equal(await live.liveVoice.generate([], context), "That is BEEP BEEP!");
  const stages = [];
  const emitted = [];
  const workflow = { then(step) { stages.push(step); return this; }, commit() { return this; } };
  loadBackendSource("src/backend/src/mastra/workflows/chatWorkflow.ts", {
    "@mastra/core/workflows": { createStep: (step) => step, createWorkflow: () => workflow },
    "@mastra/core/di": { RuntimeContext: Map },
    "../../utils/streamUtils": { handleTextStream: async (text) => emitted.push(text) },
    "./chatWorkflowTypes": { ActionSchema: backendRequire("zod").z.object({}) },
    "../../lib/prompts": prompts,
    "../agents/defaultAgent": { defaultAgent: { async streamVNext(_messages, options) {
      captures.push(options.instructions);
      return { fullStream: (async function* () { for (const text of ["That is fu", "ck", "ing bull", "shit!"]) yield { type: "text-delta", payload: { text } }; })(), usage: Promise.resolve({}) };
    } } },
  });
  const result = await stages[0].execute({ inputData: { prompt: "What concerns you?", additionalContext: context, streamController: {}, maxTokens: 768 } });
  assert.equal(result.content, "That is BEEP BEEP!");
  assert.equal(emitted.join(""), "That is BEEP BEEP!");
  assert.ok(emitted.every((part) => !/fuck|shit/i.test(part)));
  assert.equal(captures.length, 3);
  for (const prompt of captures) {
    assert.ok(prompt.includes(scenarioFixture.userRole));
    assert.ok(prompt.includes(prompts.bartTemperPrompt), "Every text and voice adapter must receive the same temper instructions");
    assert.ok(prompt.includes(scenarioFixture.npcs[0].scenarioSpecificInfo));
    assert.doesNotMatch(prompt, /recently your performance has declined due to personal family issues/);
  }
});

test("OpenAI voice startup receives the selected NPC and learner roles before delegation", async () => {
  const { createLiveVoiceService } = loadBackendSource("src/backend/src/lib/voice.ts", { "./prompts": prompts });
  let sessionRequest;
  const service = createLiveVoiceService({
    apiKey: () => "synthetic-key",
    request: async (_url, init) => {
      sessionRequest = JSON.parse(init.body);
      return Response.json({ session: { id: "adaptive-live-session" }, transport: { sdp: "answer" } });
    },
    generate: async () => "Reply",
    save: async () => {},
  });
  const session = await service.create({ sdp: "offer", threadId: "adaptive-session", resourceId: "owner", messages: [], context: { chatType: { data: "scenario" }, scenarioDetails: { data: scenarioFixture } } }, "owner");
  assert.ok(sessionRequest.session.instructions.includes(scenarioFixture.userRole));
  assert.ok(sessionRequest.session.instructions.includes(prompts.bartTemperPrompt));
  assert.ok(sessionRequest.session.instructions.includes(scenarioFixture.npcs[0].personality));
  assert.ok(sessionRequest.session.instructions.includes(scenarioFixture.npcs[0].scenarioSpecificInfo));
  assert.doesNotMatch(sessionRequest.session.instructions, /Be humble and apologetic about your recent performance/);
  await service.end(session.sessionId, session.token, "owner");
});
