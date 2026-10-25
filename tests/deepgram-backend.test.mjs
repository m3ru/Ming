import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { backendRequire, loadBackendSource } from "./backend-runtime.mjs";

const voice = loadBackendSource("src/backend/src/lib/voice.ts", { "./prompts": loadBackendSource("src/backend/src/lib/prompts.ts") });
const { createDeepgramVoiceService, DEEPGRAM_AUDIO_BYTE_LIMIT } = loadBackendSource(
  "src/backend/src/lib/deepgramVoice.ts", { "./voice": voice },
);
const secret = "synthetic-key-and-private-provider-diagnostics";
const recording = (overrides = {}) => ({
  turnId: randomUUID(), threadId: "owned-thread", context: { chatType: { data: "scenario" } },
  messages: [], audioBase64: Buffer.from("actual browser audio bytes").toString("base64"),
  mimeType: "audio/webm;codecs=opus", ...overrides,
});
const transcript = (text = "I would like to help you improve.") => Response.json({
  results: { channels: [{ alternatives: [{ transcript: text }] }] },
});
const speech = (body = Buffer.from("MP3 output")) => new Response(body, { headers: { "Content-Type": "audio/mpeg" } });
function fixture(overrides = {}) {
  const requests = [], saves = [], generations = [];
  const dependencies = {
    apiKey: () => secret,
    request: async (url, options) => {
      requests.push({ url: new URL(url), options });
      return new URL(url).pathname.endsWith("listen") ? transcript() : speech();
    },
    generate: async (...args) => { generations.push(args); return "Thank you. I appreciate your support."; },
    save: async (messages, scope) => saves.push({ messages, scope }),
    ...overrides,
  };
  return { service: createDeepgramVoiceService(dependencies), dependencies, requests, saves, generations };
}

test("Deepgram REST turn sends binary audio, saves actual text before speech, and deduplicates completed turns", async () => {
  const f = fixture();
  const input = recording();
  const result = await f.service.turn(input, "owner");
  assert.equal(result.status, "success");
  assert.equal(result.persisted, true);
  assert.equal(result.audioMimeType, "audio/mpeg");
  assert.equal(Buffer.from(result.audioBase64, "base64").toString(), "MP3 output");
  assert.equal(result.sessionId, "deepgram-" + input.turnId);
  assert.deepEqual(result.messages.map((m) => m.role), ["user", "assistant"]);
  assert.equal(result.messages[0].id, "voice-deepgram-" + input.turnId + "-user");
  assert.equal(result.messages[0].metadata.voiceProvider, "deepgram");
  assert.deepEqual(f.saves.map((s) => s.messages[0].content), result.messages.map((m) => m.content));
  assert.equal(f.saves[0].scope.threadId, input.threadId);
  assert.equal(f.saves[0].scope.resourceId, "owner");
  assert.equal(f.generations[0][0].at(-1).content, result.messages[0].content);
  assert.deepEqual(f.generations[0][1], input.context);
  assert.ok(f.generations[0][2] instanceof AbortSignal);
  const [listen, speak] = f.requests;
  assert.equal(listen.url.origin, "https://api.deepgram.com");
  assert.equal(listen.url.pathname, "/v1/listen");
  assert.equal(listen.url.searchParams.get("model"), "nova-3");
  assert.equal(listen.url.searchParams.get("smart_format"), "true");
  assert.equal(listen.options.headers.Authorization, "Token " + secret);
  assert.equal(listen.options.headers["Content-Type"], input.mimeType);
  assert.equal(Buffer.from(listen.options.body).toString(), "actual browser audio bytes");
  assert.equal(listen.options.redirect, "error");
  assert.ok(listen.options.signal instanceof AbortSignal);
  assert.equal(speak.url.pathname, "/v1/speak");
  assert.equal(speak.url.searchParams.get("model"), "aura-2-orion-en");
  assert.equal(speak.url.searchParams.get("encoding"), "mp3");
  assert.deepEqual(JSON.parse(speak.options.body), { text: result.messages[1].content });
  assert.deepEqual(await f.service.turn(input, "owner"), result);
  assert.equal(f.requests.length, 2);
  assert.equal(f.saves.length, 2);
});

test("Deepgram model overrides and MediaRecorder formats cross the actual HTTP boundary", async () => {
  for (const mimeType of ["audio/webm", "audio/ogg;codecs=opus", "audio/mp4;codecs=mp4a.40.2", "audio/wav", "audio/x-wav"]) {
    const f = fixture({ sttModel: () => "nova-3-general", ttsModel: () => "aura-2-asteria-en" });
    await f.service.turn(recording({ mimeType }), "owner");
    assert.equal(f.requests[0].options.headers["Content-Type"], mimeType);
    assert.equal(f.requests[0].url.searchParams.get("model"), "nova-3-general");
    assert.equal(f.requests[1].url.searchParams.get("model"), "aura-2-asteria-en");
  }
});

test("audio validation rejects malformed base64, arbitrary URLs, unsupported formats, and oversized decoded bytes before HTTP", async () => {
  const f = fixture();
  for (const audioBase64 of ["https://example.com/audio", "data:audio/webm;base64,YQ==", "YQ=", "!!!!", "YR=="]) {
    await assert.rejects(f.service.turn(recording({ audioBase64 }), "owner"));
  }
  for (const mimeType of ["application/json", "audio/mpeg", "video/mp4", "audio/webm\r\nX-Test: value"]) {
    await assert.rejects(f.service.turn(recording({ mimeType }), "owner"));
  }
  await assert.rejects(f.service.turn(recording({ audioBase64: Buffer.alloc(DEEPGRAM_AUDIO_BYTE_LIMIT + 1).toString("base64") }), "owner"), (e) => e.status === 413);
  assert.equal(f.requests.length, 0);
});

test("missing key, empty speech, and STT errors never invent messages or expose provider details", async () => {
  const missing = fixture({ apiKey: () => "   " });
  await assert.rejects(missing.service.turn(recording(), "owner"), (e) => e.status === 503 && !e.message.includes(secret));
  assert.equal(missing.requests.length, 0);
  for (const response of [() => transcript("  "), () => new Response(secret, { status: 401 }), () => Response.json({ secret })]) {
    const f = fixture({ request: async () => response() });
    await assert.rejects(f.service.turn(recording(), "owner"), (e) => [400, 502].includes(e.status) && !e.message.includes(secret));
    assert.equal(f.saves.length, 0);
    assert.equal(f.generations.length, 0);
  }
});

test("text failure preserves the recognized user and retry resumes without another STT or user save", async () => {
  let generations = 0;
  const f = fixture({ generate: async () => { if (++generations === 1) throw new Error(secret); return "Recovered reply"; } });
  const input = recording();
  const failed = await f.service.turn(input, "owner");
  assert.equal(failed.status, "partial");
  assert.equal(failed.persisted, true);
  assert.deepEqual(failed.messages.map((m) => m.role), ["user"]);
  assert.doesNotMatch(JSON.stringify(failed), new RegExp(secret));
  assert.equal(f.requests.length, 1);
  const recovered = await f.service.turn(input, "owner");
  assert.equal(recovered.status, "success");
  assert.equal(f.requests.length, 2);
  assert.equal(f.saves.length, 2);
  assert.equal(generations, 2);
});

test("failed user persistence returns persisted false and retries the same recognized text", async () => {
  let saves = 0;
  const saved = [];
  const f = fixture({ save: async (messages) => { if (++saves === 1) throw new Error(secret); saved.push(...messages); } });
  const input = recording();
  const failed = await f.service.turn(input, "owner");
  assert.equal(failed.status, "partial");
  assert.equal(failed.persisted, false);
  assert.deepEqual(failed.messages, []);
  assert.equal(f.generations.length, 0);
  const recovered = await f.service.turn(input, "owner");
  assert.equal(recovered.status, "success");
  assert.equal(f.requests.length, 2);
  assert.deepEqual(saved.map((m) => m.role), ["user", "assistant"]);
});

test("failed assistant persistence never returns or speaks an unsaved assistant, and retry reuses its generated text", async () => {
  let saves = 0;
  const f = fixture({ save: async () => { if (++saves === 2) throw new Error(secret); } });
  const input = recording();
  const failed = await f.service.turn(input, "owner");
  assert.equal(failed.persisted, true);
  assert.deepEqual(failed.messages.map((m) => m.role), ["user"]);
  assert.equal(f.requests.length, 1);
  assert.equal((await f.service.turn(input, "owner")).status, "success");
  assert.equal(f.generations.length, 1);
  assert.equal(f.requests.length, 2);
});

test("speech failure returns both saved messages and can retry speech without duplicating text work", async () => {
  let speechRequests = 0;
  const f = fixture({ request: async (url) => {
    if (new URL(url).pathname.endsWith("listen")) return transcript();
    if (++speechRequests === 1) return new Response(secret, { status: 429 });
    return speech();
  } });
  const input = recording();
  const failed = await f.service.turn(input, "owner");
  assert.equal(failed.status, "partial");
  assert.equal(failed.persisted, true);
  assert.equal(failed.messages.length, 2);
  assert.equal(failed.audioBase64, undefined);
  assert.doesNotMatch(JSON.stringify(failed), new RegExp(secret));
  assert.equal((await f.service.turn(input, "owner")).status, "success");
  assert.equal(f.generations.length, 1);
  assert.equal(f.saves.length, 2);
});

test("concurrent duplicate turns share provider work and one quota reservation; scope or recording reuse is rejected", async () => {
  let finish, calls = 0, reserves = 0, releases = 0;
  const gate = new Promise((resolve) => { finish = resolve; });
  const f = fixture({
    request: async (url) => { calls++; await gate; return new URL(url).pathname.endsWith("listen") ? transcript() : speech(); },
    reserve: () => { reserves++; return () => { releases++; }; },
  });
  const input = recording();
  const one = f.service.turn(input, "owner"), two = f.service.turn(input, "owner");
  assert.equal(calls, 1);
  assert.equal(reserves, 1);
  for (const [body, owner] of [[input, "attacker"], [{ ...input, threadId: "other" }, "owner"], [{ ...input, context: { changed: true } }, "owner"]]) {
    await assert.rejects(f.service.turn(body, owner), (e) => e.status === 409);
  }
  finish();
  assert.deepEqual(await one, await two);
  assert.equal(calls, 2);
  assert.equal(releases, 1);
});

test("provider response size and audio type are bounded without leaking bodies", async () => {
  const tooMuchJson = fixture({ request: async () => new Response(" ".repeat(256 * 1024 + 1) + secret) });
  await assert.rejects(tooMuchJson.service.turn(recording(), "owner"), (e) => e.status === 502 && !e.message.includes(secret));
  for (const output of [() => Response.json({ secret }), () => speech(Buffer.alloc(DEEPGRAM_AUDIO_BYTE_LIMIT + 1)), () => speech(Buffer.alloc(0))]) {
    const f = fixture({ request: async (url) => new URL(url).pathname.endsWith("listen") ? transcript() : output() });
    const result = await f.service.turn(recording(), "owner");
    assert.equal(result.status, "partial");
    assert.equal(result.persisted, true);
    assert.equal(result.messages.length, 2);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
  }
});

test("turn cache has a hard bound, sheds old audio, and does not evict completed IDs to repeat provider work", async () => {
  const f = fixture();
  const first = recording();
  assert.equal(typeof (await f.service.turn(first, "owner")).audioBase64, "string");
  let latest;
  for (let i = 1; i < 512; i++) {
    latest = recording();
    await f.service.turn(latest, "owner");
  }
  await assert.rejects(f.service.turn(recording(), "owner"), (e) => e.status === 429);
  const replayed = await f.service.turn(first, "owner");
  assert.equal(replayed.status, "success");
  assert.equal(replayed.messages.length, 2);
  // Old replies keep their text but not their audio; the newest keep audio for retries.
  assert.equal(replayed.audioBase64, undefined);
  assert.equal(typeof (await f.service.turn(latest, "owner")).audioBase64, "string");
  assert.equal(f.requests.length, 1024);
});

test("server adapter persists both real transcript texts in Mastra memory and selects the Bart or coach prompt", async () => {
  const { Memory } = backendRequire("@mastra/memory");
  const { LibSQLStore } = backendRequire("@mastra/libsql");
  const memory = new Memory({ storage: new LibSQLStore({ url: ":memory:" }), options: { lastMessages: 20 } });
  const providers = loadBackendSource("src/backend/src/lib/providers.ts");
  const prompts = loadBackendSource("src/backend/src/lib/prompts.ts");
  const generations = [];
  const envNames = ["MING_TEXT_PROVIDER", "GEMINI_MODEL", "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GOOGLE_API_KEY", "DEEPGRAM_API_KEY"];
  const original = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  try {
    for (const [provider, model, lowThinking] of [
      ["gemini", "gemini-3.8-flash", true],
      ["gemini", "gemini-3.5-flash", true],
      ["gemini", "gemini-3-flash-preview", true],
      ["gemini", "gemini-2.5-flash", false],
      ["gemini", "custom-model", false],
      ["gemini", "gemini-30-custom", false],
      ["openai", "gemini-3.8-flash", false],
    ]) {
      process.env.MING_TEXT_PROVIDER = provider;
      process.env.GEMINI_MODEL = model;
      delete process.env.OPENAI_API_KEY;
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
      delete process.env.GOOGLE_API_KEY;
      process.env.DEEPGRAM_API_KEY = "synthetic-deepgram";
      const scope = { threadId: "adapter-" + provider + "-" + model.replaceAll(".", "-"), resourceId: "owner" };
      await memory.createThread({ ...scope, title: "Voice practice" });
      const { deepgramVoice } = loadBackendSource("src/backend/src/mastra/deepgramVoice.ts", {
        "@mastra/core/agent": { Agent: class {
          constructor(options) {
            assert.match(options.instructions, /keep replies under 100 words/);
          }
          async generateVNext(messages, options) { generations.push({ messages, options }); return { text: "A saved spoken reply." }; }
        } },
        "../lib/deepgramVoice": { createDeepgramVoiceService: (dependencies) => createDeepgramVoiceService({
          ...dependencies,
          request: async (url) => new URL(url).pathname.endsWith("listen") ? transcript("An actual recognized statement.") : speech(),
        }) },
        "../lib/prompts": prompts,
        "../lib/providers": providers,
        "../lib/security": { reserveGeneration: () => () => {} },
        "../lib/voice": voice,
        "./agents/defaultAgent": { defaultAgent: { getMemory: async () => memory } },
        "./models": { ...providers, textModel: {} },
      });
      const context = { chatType: { data: provider === "gemini" ? "scenario" : "transcript" }, scenarioDetails: { data: { title: "Review" } } };
      const input = recording({ threadId: scope.threadId, context });
      const partial = await deepgramVoice.turn(input, scope.resourceId);
      assert.equal(partial.status, "partial");
      assert.equal(partial.persisted, true);
      assert.equal(partial.messages[0].content, "An actual recognized statement.");
      process.env[provider === "gemini" ? "GEMINI_API_KEY" : "OPENAI_API_KEY"] = "synthetic-text-key";
      const result = await deepgramVoice.turn(input, scope.resourceId);
      assert.equal(result.status, "success");
      const { messagesV2 } = await memory.query(scope);
      assert.equal(messagesV2.length, 2);
      assert.ok(messagesV2.some((m) => m.role === "user" && m.content.parts[0].text === "An actual recognized statement."));
      assert.ok(messagesV2.some((m) => m.role === "assistant" && m.content.parts[0].text === "A saved spoken reply."));
      assert.ok(messagesV2.every((m) => m.content.metadata.source === "live-voice" && m.content.metadata.voiceProvider === "deepgram"));
      assert.ok(generations.at(-1).messages[0].content.includes(provider === "gemini" ? prompts.bartPrompt : prompts.feedbackReplyPrompt));
      assert.ok(generations.at(-1).messages[0].content.includes(JSON.stringify(context)));
      assert.ok(generations.at(-1).options.abortSignal instanceof AbortSignal);
      assert.deepEqual(generations.at(-1).options.modelSettings, {
        maxOutputTokens: provider === "gemini" ? 1024 : 250,
      });
      assert.deepEqual(generations.at(-1).options.providerOptions, lowThinking
        ? { google: { thinkingConfig: { thinkingLevel: "low" } } }
        : undefined);
    }
  } finally {
    for (const [name, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
