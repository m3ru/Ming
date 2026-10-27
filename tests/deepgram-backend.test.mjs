import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { backendRequire, loadBackendSource } from "./backend-runtime.mjs";

const voice = loadBackendSource("src/backend/src/lib/voice.ts", { "./prompts": loadBackendSource("src/backend/src/lib/prompts.ts") });
const { createDeepgramVoiceService, DEEPGRAM_AUDIO_BYTE_LIMIT, PCM_BYTE_LIMIT } = loadBackendSource(
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
const geminiKey = "synthetic-gemini-key";
const geminiHost = "generativelanguage.googleapis.com";
const openaiKey = "synthetic-openai-key";
const openaiHost = "api.openai.com";
const openaiPcm = (body = pcm) => new Response(body, { headers: { "Content-Type": "audio/pcm" } });
// Gemini's SSE shape: one data line per event, CRLF separators, base64 L16 PCM parts.
const pcmEvent = (...chunks) => ({ candidates: [{ content: { role: "model", parts: chunks.map((bytes) => ({
  inlineData: { mimeType: "audio/l16; rate=24000; channels=1", data: Buffer.from(bytes).toString("base64") },
})) } }] });
const sse = (events, { separator = "\r\n\r\n", ...options } = {}) =>
  chunked(events.map((event) => "data: " + JSON.stringify(event) + separator).join(""), options);
function chunked(text, { split = 4096, onCancel, fail } = {}) {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  // Pull-based so a failure arrives only after every earlier chunk was read.
  return new Response(new ReadableStream({
    pull(controller) {
      if (offset < bytes.length) controller.enqueue(bytes.slice(offset, offset += split));
      else if (fail) controller.error(fail);
      else controller.close();
    },
    cancel: onCancel,
  }, { highWaterMark: 0 }), { headers: { "Content-Type": "text/event-stream" } });
}
const pcm = Buffer.from([1, 2, 3, 4, 250, 251, 252, 253]);
function fixture(overrides = {}) {
  const requests = [], saves = [], generations = [];
  const {
    gemini = () => sse([pcmEvent(pcm)]),
    openai = () => openaiPcm(),
    openaiStt = () => Response.json({ text: "Words heard by OpenAI." }),
    ...rest
  } = overrides;
  const dependencies = {
    apiKey: () => secret,
    request: async (url, options) => {
      requests.push({ url: new URL(url), options });
      const { hostname, pathname } = new URL(url);
      return pathname.endsWith("listen") ? transcript() : pathname.endsWith("/audio/transcriptions") ? openaiStt(options)
        : hostname === geminiHost ? gemini(options) : hostname === openaiHost ? openai(options) : speech();
    },
    generate: async (...args) => { generations.push(args); return "Thank you. I appreciate your support."; },
    save: async (messages, scope) => saves.push({ messages, scope }),
    ...rest,
  };
  return { service: createDeepgramVoiceService(dependencies), dependencies, requests, saves, generations };
}

test("Deepgram REST turn sends binary audio, reports each message once saved, ends without audio, and deduplicates completed turns", async () => {
  const log = [];
  const f = fixture({
    generate: async () => { log.push("generate"); return "Thank you. I appreciate your support."; },
    save: async (messages) => { log.push("save:" + messages[0].role); },
  });
  const input = recording();
  const events = [];
  const result = await f.service.turn(input, "owner", (message) => { events.push(message); log.push("emit:" + message.role); });
  // The user's words are reported before the reply is even generated.
  assert.deepEqual(log, ["save:user", "emit:user", "generate", "save:assistant", "emit:assistant"]);
  assert.deepEqual(events, result.messages);
  assert.deepEqual(Object.keys(result).sort(), ["messages", "persisted", "sessionId", "status"]);
  assert.equal(result.status, "success");
  assert.equal(result.persisted, true);
  assert.equal(result.sessionId, "deepgram-" + input.turnId);
  assert.deepEqual(result.messages.map((m) => m.role), ["user", "assistant"]);
  assert.equal(result.messages[0].id, "voice-deepgram-" + input.turnId + "-user");
  assert.equal(result.messages[0].metadata.voiceProvider, "deepgram");
  const g = fixture();
  const saved = await g.service.turn(input, "owner");
  assert.deepEqual(g.saves.map((s) => s.messages[0].content), saved.messages.map((m) => m.content));
  assert.equal(g.saves[0].scope.threadId, input.threadId);
  assert.equal(g.saves[0].scope.resourceId, "owner");
  assert.equal(g.generations[0][0].at(-1).content, saved.messages[0].content);
  assert.deepEqual(g.generations[0][1], input.context);
  assert.ok(g.generations[0][2] instanceof AbortSignal);
  assert.equal(g.requests.length, 1, "speech is no longer part of the turn");
  const [listen] = g.requests;
  assert.equal(listen.url.origin, "https://api.deepgram.com");
  assert.equal(listen.url.pathname, "/v1/listen");
  assert.equal(listen.url.searchParams.get("model"), "nova-3");
  assert.equal(listen.url.searchParams.get("smart_format"), "true");
  assert.equal(listen.options.headers.Authorization, "Token " + secret);
  assert.equal(listen.options.headers["Content-Type"], input.mimeType);
  assert.equal(Buffer.from(listen.options.body).toString(), "actual browser audio bytes");
  assert.equal(listen.options.redirect, "error");
  assert.ok(listen.options.signal instanceof AbortSignal);
  const replayed = [];
  assert.deepEqual(await g.service.turn(input, "owner", (message) => replayed.push(message)), saved);
  assert.deepEqual(replayed, saved.messages, "a completed retry replays both saved messages");
  assert.equal(g.requests.length, 1);
  assert.equal(g.saves.length, 2);
});

test("Deepgram model overrides and MediaRecorder formats cross the actual HTTP boundary", async () => {
  for (const mimeType of ["audio/webm", "audio/ogg;codecs=opus", "audio/mp4;codecs=mp4a.40.2", "audio/wav", "audio/x-wav"]) {
    const f = fixture({ sttModel: () => "nova-3-general", ttsModel: () => "aura-2-asteria-en" });
    const input = recording({ mimeType });
    await f.service.turn(input, "owner");
    await f.service.speech({ turnId: input.turnId, threadId: input.threadId }, "owner");
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
  const events = [];
  const recovered = await f.service.turn(input, "owner", (message) => events.push(message.role));
  assert.equal(recovered.status, "success");
  assert.deepEqual(events, ["user", "assistant"], "the retry first hears the already-saved user");
  assert.equal(f.requests.length, 1);
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
  assert.equal(f.requests.length, 1, "the recognized text is reused without another STT call");
  assert.deepEqual(saved.map((m) => m.role), ["user", "assistant"]);
});

test("failed assistant persistence never returns, reports or speaks an unsaved assistant, and retry reuses its generated text", async () => {
  let saves = 0;
  const f = fixture({ save: async () => { if (++saves === 2) throw new Error(secret); } });
  const input = recording();
  const events = [];
  const failed = await f.service.turn(input, "owner", (message) => events.push(message.role));
  assert.equal(failed.persisted, true);
  assert.deepEqual(failed.messages.map((m) => m.role), ["user"]);
  assert.deepEqual(events, ["user"]);
  await assert.rejects(f.service.speech({ turnId: input.turnId, threadId: input.threadId }, "owner"), (e) => e.status === 409);
  assert.equal(f.requests.length, 1);
  assert.equal((await f.service.turn(input, "owner")).status, "success");
  assert.equal(f.generations.length, 1);
  assert.equal(f.requests.length, 1);
});

const read = async (body) => Buffer.from(await new Response(body).arrayBuffer());
const speechOf = (input) => ({ turnId: input.turnId, threadId: input.threadId });

test("speech streams the saved reply's audio from Deepgram without reserving more quota", async () => {
  let reserves = 0;
  const f = fixture({ reserve: () => { reserves++; return () => {}; } });
  const input = recording();
  const result = await f.service.turn(input, "owner");
  assert.equal(reserves, 1);
  const audio = await f.service.speech(speechOf(input), "owner");
  assert.equal(audio.mimeType, "audio/mpeg");
  assert.ok(audio.body instanceof ReadableStream);
  assert.equal((await read(audio.body)).toString(), "MP3 output");
  assert.equal(reserves, 1, "the turn's reservation already paid for speech");
  const speak = f.requests[1];
  assert.equal(speak.url.origin, "https://api.deepgram.com");
  assert.equal(speak.url.pathname, "/v1/speak");
  assert.equal(speak.url.searchParams.get("model"), "aura-2-orion-en");
  assert.equal(speak.url.searchParams.get("encoding"), "mp3");
  assert.deepEqual([...speak.url.searchParams.keys()].sort(), ["encoding", "model"]);
  assert.equal(speak.options.headers.Authorization, "Token " + secret);
  assert.deepEqual(JSON.parse(speak.options.body), { text: result.messages[1].content });
  assert.equal(speak.options.redirect, "error");
  assert.ok(speak.options.signal instanceof AbortSignal);
  assert.equal(f.generations.length, 1);
  assert.equal(f.saves.length, 2);
});

test("speech is limited to the owner of a saved reply and to three requests per turn", async () => {
  let finish;
  const gate = new Promise((resolve) => { finish = resolve; });
  const f = fixture({ generate: async () => { await gate; return "Gated reply"; } });
  const input = recording();
  const pending = f.service.turn(input, "owner");
  await new Promise(setImmediate);
  await assert.rejects(f.service.speech(speechOf(input), "owner"), (e) => e.status === 409, "not ready while generating");
  finish();
  await pending;
  await assert.rejects(f.service.speech({ ...speechOf(input), turnId: randomUUID() }, "owner"), (e) => e.status === 404);
  await assert.rejects(f.service.speech(speechOf(input), "attacker"), (e) => e.status === 403);
  await assert.rejects(f.service.speech({ ...speechOf(input), threadId: "other-thread" }, "owner"), (e) => e.status === 403);
  await assert.rejects(f.service.speech({ ...speechOf(input), turnId: "not-a-uuid" }, "owner"));
  assert.equal(f.requests.length, 1, "rejected requests never reach Deepgram");
  for (let i = 0; i < 3; i++) await read((await f.service.speech(speechOf(input), "owner")).body);
  await assert.rejects(f.service.speech(speechOf(input), "owner"), (e) => e.status === 429);
  assert.equal(f.requests.length, 4);
  let key = secret;
  const keyless = fixture({ apiKey: () => key });
  const other = recording();
  await keyless.service.turn(other, "owner");
  key = " ";
  await assert.rejects(keyless.service.speech(speechOf(other), "owner"), (e) => e.status === 503);
  assert.equal(keyless.requests.length, 1);
});

test("speech provider failures, wrong types and oversized or empty audio fail without leaking bodies", async () => {
  for (const output of [() => new Response(secret, { status: 429 }), () => Response.json({ secret }), async () => { throw new Error(secret); }]) {
    const f = fixture({ request: async (url) => new URL(url).pathname.endsWith("listen") ? transcript() : output() });
    const input = recording();
    await f.service.turn(input, "owner");
    await assert.rejects(f.service.speech(speechOf(input), "owner"), (e) => e.status === 502 && !e.message.includes(secret));
    // A failed attempt counts, so a retry is possible but bounded.
    await assert.rejects(f.service.speech(speechOf(input), "owner"), (e) => e.status === 502);
  }
  for (const body of [Buffer.alloc(DEEPGRAM_AUDIO_BYTE_LIMIT + 1), Buffer.alloc(0)]) {
    const f = fixture({ request: async (url) => new URL(url).pathname.endsWith("listen") ? transcript() : speech(body) });
    const input = recording();
    await f.service.turn(input, "owner");
    const audio = await f.service.speech(speechOf(input), "owner");
    await assert.rejects(read(audio.body));
  }
  const exact = fixture({ request: async (url) => new URL(url).pathname.endsWith("listen") ? transcript() : speech(Buffer.alloc(DEEPGRAM_AUDIO_BYTE_LIMIT, 7)) });
  const input = recording();
  await exact.service.turn(input, "owner");
  assert.equal((await read((await exact.service.speech(speechOf(input), "owner")).body)).length, DEEPGRAM_AUDIO_BYTE_LIMIT);
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
  assert.equal(calls, 1);
  assert.equal(releases, 1);
});

test("a retry joining an in-flight turn hears already-saved messages first, then later ones, with no new provider calls", async () => {
  let finish, reserves = 0;
  const gate = new Promise((resolve) => { finish = resolve; });
  const f = fixture({
    generate: async (...args) => { f.generations.push(args); await gate; return "Joined reply"; },
    reserve: () => { reserves++; return () => {}; },
  });
  const input = recording();
  const first = [], joined = [];
  const one = f.service.turn(input, "owner", (message) => first.push(message.role));
  await new Promise(setImmediate);
  assert.deepEqual(first, ["user"]);
  const two = f.service.turn(input, "owner", (message) => joined.push(message.role));
  assert.deepEqual(joined, ["user"], "the saved user is replayed at once");
  finish();
  assert.deepEqual(await one, await two);
  assert.deepEqual(first, ["user", "assistant"]);
  assert.deepEqual(joined, ["user", "assistant"]);
  assert.equal(f.requests.length, 1);
  assert.equal(f.generations.length, 1);
  assert.equal(f.saves.length, 2);
  assert.equal(reserves, 1);
});

test("provider transcription size is bounded without leaking bodies", async () => {
  const tooMuchJson = fixture({ request: async () => new Response(" ".repeat(256 * 1024 + 1) + secret) });
  await assert.rejects(tooMuchJson.service.turn(recording(), "owner"), (e) => e.status === 502 && !e.message.includes(secret));
});

test("turn cache has a hard bound and does not evict completed IDs to repeat provider work", async () => {
  const f = fixture();
  const first = recording();
  await f.service.turn(first, "owner");
  for (let i = 1; i < 512; i++) await f.service.turn(recording(), "owner");
  await assert.rejects(f.service.turn(recording(), "owner"), (e) => e.status === 429);
  const replayed = await f.service.turn(first, "owner");
  assert.equal(replayed.status, "success");
  assert.equal(replayed.messages.length, 2);
  assert.equal(f.requests.length, 512);
  assert.equal(f.generations.length, 512);
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
      // Only the role-played character gets spoken-delivery guidance; the coach stays plain.
      assert.equal(generations.at(-1).messages[0].content.includes("spoken aloud by a text-to-speech voice"), provider === "gemini");
      assert.ok(generations.at(-1).messages[0].content.includes(JSON.stringify(context)));
      assert.ok(generations.at(-1).options.abortSignal instanceof AbortSignal);
      assert.deepEqual(generations.at(-1).options.modelSettings, {
        maxOutputTokens: provider === "gemini" ? 1024 : 2048,
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

const gemini = (overrides = {}) => fixture({ ttsProvider: () => "gemini", geminiApiKey: () => geminiKey, ...overrides });
const hosts = (f) => f.requests.slice(1).map((r) => r.url.hostname);

test("Gemini speech is opt-in: an unset, deepgram or unknown TTS provider calls only Deepgram", async () => {
  for (const provider of [undefined, "deepgram", "", "openai-tts", "geminii"]) {
    const f = fixture({ ttsProvider: () => provider, geminiApiKey: () => geminiKey });
    const input = recording();
    await f.service.turn(input, "owner");
    const audio = await f.service.speech(speechOf(input), "owner");
    assert.equal(audio.mimeType, "audio/mpeg");
    assert.equal((await read(audio.body)).toString(), "MP3 output");
    assert.deepEqual(hosts(f), ["api.deepgram.com"], String(provider));
  }
});

test("Gemini speech sends the model, voice, key header and only the reply text, and streams raw PCM", async () => {
  let reserves = 0;
  const f = gemini({ ttsProvider: () => " Gemini ", reserve: () => { reserves++; return () => {}; } });
  const input = recording();
  const result = await f.service.turn(input, "owner");
  const audio = await f.service.speech(speechOf(input), "owner");
  assert.equal(audio.mimeType, "audio/L16; rate=24000; channels=1");
  assert.ok(audio.body instanceof ReadableStream);
  assert.deepEqual(await read(audio.body), pcm);
  assert.equal(reserves, 1, "speech reserves no extra quota");
  assert.deepEqual(hosts(f), [geminiHost], "Deepgram is not called when Gemini speaks");
  const [, call] = f.requests;
  assert.equal(call.url.href, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-lite-tts:streamGenerateContent?alt=sse");
  assert.equal(call.options.method, "POST");
  assert.deepEqual(call.options.headers, { "x-goog-api-key": geminiKey, "Content-Type": "application/json" });
  assert.doesNotMatch(JSON.stringify(call.options), new RegExp(secret), "the Deepgram key never goes to Google");
  assert.equal(call.options.redirect, "error");
  assert.ok(call.options.signal instanceof AbortSignal);
  const body = JSON.parse(call.options.body);
  assert.deepEqual(body.generationConfig, {
    responseModalities: ["AUDIO"],
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } },
  });
  // Gemini 3.8 TTS reads any style direction aloud, so it must get exactly the reply.
  assert.equal(body.contents[0].parts[0].text, result.messages[1].content);

  const coach = gemini({ geminiTtsModel: () => " gemini-2.5-pro-preview-tts ", geminiTtsVoice: () => " Kore " });
  const review = recording({ context: { chatType: { data: "transcript" } } });
  await coach.service.turn(review, "owner");
  await read((await coach.service.speech(speechOf(review), "owner")).body);
  const [, coachCall] = coach.requests;
  assert.equal(coachCall.url.pathname, "/v1beta/models/gemini-2.5-pro-preview-tts:streamGenerateContent");
  const coachBody = JSON.parse(coachCall.options.body);
  assert.equal(coachBody.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, "Kore");
  assert.equal(coachBody.contents[0].parts[0].text, "Thank you. I appreciate your support.");
});

test("Gemini or OpenAI that has sent no audio by the deadline falls back to Deepgram instead of stalling", async (t) => {
  const { FIRST_AUDIO_MS } = loadBackendSource("src/backend/src/lib/deepgramVoice.ts", { "./voice": voice });
  const silent = (type) => ({ signal }) => new Response(new ReadableStream({
    start: (controller) => signal.addEventListener("abort", () => controller.error(signal.reason), { once: true }),
  }), { headers: { "Content-Type": type } });
  // No response headers at all.
  const noResponse = ({ signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  const stalls = {
    "Gemini no response": [geminiHost, () => gemini({ gemini: noResponse })],
    // Headers arrive, but no audio follows.
    "Gemini no audio": [geminiHost, () => gemini({ gemini: silent("text/event-stream") })],
    "OpenAI no response": [openaiHost, () => openai({ openai: noResponse })],
    "OpenAI no audio": [openaiHost, () => openai({ openai: silent("audio/pcm") })],
  };
  for (const [name, [host, make]] of Object.entries(stalls)) {
    const f = make();
    const input = recording();
    await f.service.turn(input, "owner");
    t.mock.timers.enable({ apis: ["setTimeout"] });
    try {
      // Real time (Date is not mocked): the 30 s provider timeout must not be what ends the wait.
      const started = Date.now();
      const pending = f.service.speech(speechOf(input), "owner");
      // Let the Gemini request start, then pass the first-audio deadline.
      for (let i = 0; i < 5; i++) await Promise.resolve();
      t.mock.timers.tick(FIRST_AUDIO_MS);
      const audio = await pending;
      assert.ok(Date.now() - started < 2000, name + ": fell back only after " + (Date.now() - started) + " ms");
      assert.equal(audio.mimeType, "audio/mpeg", name);
      assert.equal((await read(audio.body)).toString(), "MP3 output", name);
      assert.deepEqual(hosts(f), [host, "api.deepgram.com"], name);
    } finally {
      t.mock.timers.reset();
    }
  }
});

test("Gemini SSE events split at any byte, with CRLF or LF separators, decode to the exact PCM bytes", async () => {
  // Odd and even part sizes, two parts in one event, and a closing finishReason event.
  const parts = [[0, 1, 2], [3, 4, 5, 6, 7, 8, 9], [10], [11, 12, 13, 14]].map((n) => Buffer.from(n.map((i) => (i * 37) % 256)));
  const events = [pcmEvent(parts[0]), pcmEvent(parts[1], parts[2]),
    { candidates: [{ content: { parts: [{ text: "ignored" }] } }] }, pcmEvent(parts[3]),
    { candidates: [{ finishReason: "STOP" }], usageMetadata: { totalTokenCount: 9 } }];
  for (const separator of ["\r\n\r\n", "\n\n"]) {
    for (const split of [1, 2, 3, 5, 7, 64, 4096]) {
      const f = gemini({ gemini: () => sse(events, { split, separator }) });
      const input = recording();
      await f.service.turn(input, "owner");
      assert.deepEqual(await read((await f.service.speech(speechOf(input), "owner")).body), Buffer.concat(parts), JSON.stringify({ separator, split }));
    }
  }
  // One event over two data lines (joined with a newline), a comment line, the codec=pcm
  // MIME form, and a last event without a trailing blank line.
  const json = JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: pcm.toString("base64") } }] } }] });
  const at = json.indexOf("[");
  const text = ": keep-alive\r\n\r\ndata: " + json.slice(0, at) + "\r\ndata: " + json.slice(at) + "\r\n\r\ndata: " + JSON.stringify(pcmEvent(parts[3])) + "\r\n";
  for (const split of [1, 2, 3, 4096]) {
    const f = gemini({ gemini: () => chunked(text, { split }) });
    const input = recording();
    await f.service.turn(input, "owner");
    assert.deepEqual(await read((await f.service.speech(speechOf(input), "owner")).body), Buffer.concat([pcm, parts[3]]), String(split));
  }
});

test("Gemini failures before any audio fall back to Deepgram within the same counted request and never relay Gemini bodies", async () => {
  let cancelled = 0;
  const failures = {
    "429 quota": () => new Response(new ReadableStream({
      start: (c) => { c.enqueue(new TextEncoder().encode(secret)); c.close(); },
      cancel: () => { cancelled++; },
    }), { status: 429 }),
    "500": () => Response.json({ error: { message: secret } }, { status: 500 }),
    "network error": async () => { throw new Error(secret); },
    "zero audio": () => sse([{ candidates: [{ finishReason: "STOP" }] }]),
    "empty body": () => new Response(""),
    "error event": () => sse([{ error: { code: 429, message: secret } }]),
    "malformed event": () => new Response("data: {" + secret + "\r\n\r\n"),
    "wrong format": () => sse([{ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/mpeg", data: "AAAA" } }] } }] }]),
    "stream error before audio": () => sse([], { fail: new Error(secret) }),
  };
  for (const [name, failure] of Object.entries(failures)) {
    const f = gemini({ gemini: failure });
    const input = recording();
    await f.service.turn(input, "owner");
    for (let i = 0; i < 3; i++) {
      const audio = await f.service.speech(speechOf(input), "owner");
      assert.equal(audio.mimeType, "audio/mpeg", name);
      assert.equal((await read(audio.body)).toString(), "MP3 output", name);
    }
    assert.deepEqual(hosts(f), Array(3).fill([geminiHost, "api.deepgram.com"]).flat(), name);
    // The fallback is part of the same request: a fourth play is still refused.
    await assert.rejects(f.service.speech(speechOf(input), "owner"), (e) => e.status === 429, name);
  }
  assert.equal(cancelled, 3, "the 429 body is cancelled, never read");
  for (const key of [undefined, " "]) {
    const keyless = gemini({ geminiApiKey: () => key });
    const input = recording();
    await keyless.service.turn(input, "owner");
    assert.equal((await keyless.service.speech(speechOf(input), "owner")).mimeType, "audio/mpeg");
    assert.deepEqual(hosts(keyless), ["api.deepgram.com"], "no request is made without a Gemini key");
  }
  const both = gemini({
    gemini: failures["429 quota"],
    request: async (url) => new URL(url).pathname.endsWith("listen") ? transcript() : new Response(secret, { status: 503 }),
  });
  const input = recording();
  await both.service.turn(input, "owner");
  await assert.rejects(both.service.speech(speechOf(input), "owner"), (e) => e.status === 502 && !e.message.includes(secret));
});

test("a Gemini failure after audio has started errors the stream instead of switching voices", async () => {
  for (const response of [
    () => sse([pcmEvent(pcm)], { fail: new Error(secret) }),
    () => sse([pcmEvent(pcm), { error: { message: secret } }]),
    () => sse([pcmEvent(pcm), { candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/l16; rate=16000", data: "AAAA" } }] } }] }]),
  ]) {
    const f = gemini({ gemini: response });
    const input = recording();
    await f.service.turn(input, "owner");
    const audio = await f.service.speech(speechOf(input), "owner");
    assert.equal(audio.mimeType, "audio/L16; rate=24000; channels=1");
    // An errored stream aborts the HTTP response; no error text reaches the browser.
    await assert.rejects(read(audio.body));
    assert.deepEqual(hosts(f), [geminiHost]);
  }
});

test("Gemini PCM is capped separately: the exact limit streams, one byte more errors the stream", async () => {
  const head = Buffer.alloc(1024, 1);
  for (const [extra, ok] of [[0, true], [1, false]]) {
    const f = gemini({ gemini: () => sse([pcmEvent(head), pcmEvent(Buffer.alloc(PCM_BYTE_LIMIT - head.length + extra, 2))]) });
    const input = recording();
    await f.service.turn(input, "owner");
    const audio = await f.service.speech(speechOf(input), "owner");
    if (ok) assert.equal((await read(audio.body)).length, PCM_BYTE_LIMIT);
    else await assert.rejects(read(audio.body));
  }
  assert.equal(PCM_BYTE_LIMIT, 4 * 1024 * 1024);
});

test("Gemini speech keeps ownership, readiness and the three-request limit", async () => {
  let finish;
  const gate = new Promise((resolve) => { finish = resolve; });
  const f = gemini({ generate: async () => { await gate; return "Gated reply"; } });
  const input = recording();
  const pending = f.service.turn(input, "owner");
  await new Promise(setImmediate);
  await assert.rejects(f.service.speech(speechOf(input), "owner"), (e) => e.status === 409);
  finish();
  await pending;
  await assert.rejects(f.service.speech(speechOf(input), "attacker"), (e) => e.status === 403);
  await assert.rejects(f.service.speech({ ...speechOf(input), threadId: "other-thread" }, "owner"), (e) => e.status === 403);
  await assert.rejects(f.service.speech({ ...speechOf(input), turnId: randomUUID() }, "owner"), (e) => e.status === 404);
  assert.deepEqual(hosts(f), []);
  for (let i = 0; i < 3; i++) await read((await f.service.speech(speechOf(input), "owner")).body);
  await assert.rejects(f.service.speech(speechOf(input), "owner"), (e) => e.status === 429);
  assert.deepEqual(hosts(f), [geminiHost, geminiHost, geminiHost]);
});

const openai = (overrides = {}) => fixture({ ttsProvider: () => "openai", openaiApiKey: () => openaiKey, ...overrides });

test("OpenAI speech sends the model, voice, delivery instructions, PCM format, Bearer key and only the reply text, and streams raw PCM", async () => {
  let reserves = 0;
  const f = openai({ ttsProvider: () => " OpenAI ", reserve: () => { reserves++; return () => {}; } });
  const input = recording();
  const result = await f.service.turn(input, "owner");
  const audio = await f.service.speech(speechOf(input), "owner");
  assert.equal(audio.mimeType, "audio/L16; rate=24000; channels=1");
  assert.deepEqual(await read(audio.body), pcm);
  assert.equal(reserves, 1, "speech reserves no extra quota");
  assert.deepEqual(hosts(f), [openaiHost], "Deepgram is not called when OpenAI speaks");
  const [, call] = f.requests;
  assert.equal(call.url.href, "https://api.openai.com/v1/audio/speech");
  assert.equal(call.options.method, "POST");
  assert.deepEqual(call.options.headers, { Authorization: "Bearer " + openaiKey, "Content-Type": "application/json" });
  assert.doesNotMatch(JSON.stringify(call.options), new RegExp(secret), "the Deepgram key never goes to OpenAI");
  assert.equal(call.options.redirect, "error");
  assert.ok(call.options.signal instanceof AbortSignal);
  const body = JSON.parse(call.options.body);
  assert.deepEqual(Object.keys(body).sort(), ["input", "instructions", "model", "response_format", "voice"]);
  assert.equal(body.model, "gpt-4o-mini-tts");
  assert.equal(body.voice, "cedar");
  assert.equal(body.response_format, "pcm");
  // Delivery direction travels in its own field; the spoken text is exactly the saved reply.
  assert.equal(body.input, result.messages[1].content);
  assert.ok(body.instructions.trim() && !body.input.includes(body.instructions));

  const custom = openai({ openaiTtsModel: () => " gpt-4o-mini-tts-2025-12-15 ", openaiTtsVoice: () => " marin " });
  const review = recording({ context: { chatType: { data: "transcript" } } });
  await custom.service.turn(review, "owner");
  await read((await custom.service.speech(speechOf(review), "owner")).body);
  const customBody = JSON.parse(custom.requests[1].options.body);
  assert.equal(customBody.model, "gpt-4o-mini-tts-2025-12-15");
  assert.equal(customBody.voice, "marin");
});

test("OpenAI failures before any audio fall back to Deepgram within the same counted request and never relay OpenAI bodies", async () => {
  let cancelled = 0;
  const failures = {
    "429 quota": () => new Response(new ReadableStream({
      start: (c) => { c.enqueue(new TextEncoder().encode(secret)); c.close(); },
      cancel: () => { cancelled++; },
    }), { status: 429 }),
    "500": () => Response.json({ error: { message: secret } }, { status: 500 }),
    "network error": async () => { throw new Error(secret); },
    "wrong format": () => Response.json({ error: secret }),
    "mp3 instead of pcm": () => speech(),
    "empty body": () => openaiPcm(""),
    "stream error before audio": () => new Response(new ReadableStream({ start: (c) => c.error(new Error(secret)) }), { headers: { "Content-Type": "audio/pcm" } }),
  };
  for (const [name, failure] of Object.entries(failures)) {
    const f = openai({ openai: failure });
    const input = recording();
    await f.service.turn(input, "owner");
    for (let i = 0; i < 3; i++) {
      const audio = await f.service.speech(speechOf(input), "owner");
      assert.equal(audio.mimeType, "audio/mpeg", name);
      assert.equal((await read(audio.body)).toString(), "MP3 output", name);
    }
    assert.deepEqual(hosts(f), Array(3).fill([openaiHost, "api.deepgram.com"]).flat(), name);
    // The fallback is part of the same request: a fourth play is still refused.
    await assert.rejects(f.service.speech(speechOf(input), "owner"), (e) => e.status === 429, name);
  }
  assert.equal(cancelled, 3, "the 429 body is cancelled, never read");
  for (const key of [undefined, " "]) {
    const keyless = openai({ openaiApiKey: () => key });
    const input = recording();
    await keyless.service.turn(input, "owner");
    assert.equal((await keyless.service.speech(speechOf(input), "owner")).mimeType, "audio/mpeg");
    assert.deepEqual(hosts(keyless), ["api.deepgram.com"], "no request is made without an OpenAI key");
  }
});

test("an OpenAI failure after audio has started errors the stream, and its PCM is capped at the shared limit", async () => {
  // One chunk per read, so a later error arrives only after earlier audio was consumed.
  const stream = (...chunks) => new ReadableStream({ pull(controller) {
    const chunk = chunks.shift();
    if (chunk === undefined) controller.close();
    else if (chunk instanceof Error) controller.error(chunk);
    else controller.enqueue(chunk);
  } });
  const broken = openai({ openai: () => new Response(stream(pcm, new Error(secret)), { headers: { "Content-Type": "audio/pcm" } }) });
  const input = recording();
  await broken.service.turn(input, "owner");
  const audio = await broken.service.speech(speechOf(input), "owner");
  assert.equal(audio.mimeType, "audio/L16; rate=24000; channels=1");
  // An errored stream aborts the HTTP response; no error text reaches the browser.
  await assert.rejects(read(audio.body));
  assert.deepEqual(hosts(broken), [openaiHost]);
  const head = Buffer.alloc(1024, 1);
  for (const [extra, ok] of [[0, true], [1, false]]) {
    const f = openai({ openai: () => new Response(stream(head, Buffer.alloc(PCM_BYTE_LIMIT - head.length + extra, 2)), { headers: { "Content-Type": "audio/pcm" } }) });
    const capped = recording();
    await f.service.turn(capped, "owner");
    const speech = await f.service.speech(speechOf(capped), "owner");
    if (ok) assert.equal((await read(speech.body)).length, PCM_BYTE_LIMIT);
    else await assert.rejects(read(speech.body));
  }
});

test("server adapter reads MING_TTS_PROVIDER, the shared Gemini key order, and the Gemini and OpenAI models and voices from env", async () => {
  const providers = loadBackendSource("src/backend/src/lib/providers.ts");
  const prompts = loadBackendSource("src/backend/src/lib/prompts.ts");
  const envNames = ["MING_TTS_PROVIDER", "GEMINI_TTS_MODEL", "GEMINI_TTS_VOICE", "GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GOOGLE_API_KEY", "MING_TEXT_PROVIDER", "OPENAI_API_KEY", "OPENAI_TTS_MODEL", "OPENAI_TTS_VOICE"];
  const original = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  const requests = [];
  const { deepgramVoice } = loadBackendSource("src/backend/src/mastra/deepgramVoice.ts", {
    "@mastra/core/agent": { Agent: class { async generateVNext() { return { text: "A spoken reply." }; } } },
    "../lib/deepgramVoice": { createDeepgramVoiceService: (dependencies) => createDeepgramVoiceService({
      ...dependencies,
      apiKey: () => secret,
      request: async (url, options) => {
        requests.push({ url: new URL(url), options });
        const { hostname, pathname } = new URL(url);
        return pathname.endsWith("listen") ? transcript() : hostname === geminiHost ? sse([pcmEvent(pcm)])
          : hostname === openaiHost ? openaiPcm() : speech();
      },
    }) },
    "../lib/prompts": prompts,
    "../lib/providers": providers,
    "../lib/security": { reserveGeneration: () => () => {} },
    "../lib/voice": voice,
    "./agents/defaultAgent": { defaultAgent: { getMemory: async () => ({
      getThreadById: async () => ({ resourceId: "owner" }),
      saveMessages: async () => {},
    }) } },
    "./models": { isTextConfigured: () => true, textModel: {} },
  });
  const speak = async () => {
    const input = recording();
    await deepgramVoice.turn(input, "owner");
    requests.length = 0;
    const audio = await deepgramVoice.speech(speechOf(input), "owner");
    await read(audio.body);
    return { mimeType: audio.mimeType, request: requests[0] };
  };
  try {
    for (const name of envNames) delete process.env[name];
    process.env.GEMINI_API_KEY = "first-key";
    assert.equal((await speak()).request.url.hostname, "api.deepgram.com", "unset provider means Deepgram");
    process.env.MING_TTS_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = " ";
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "second-key";
    process.env.GOOGLE_API_KEY = "third-key";
    let spoken = await speak();
    assert.equal(spoken.mimeType, "audio/L16; rate=24000; channels=1");
    assert.equal(spoken.request.options.headers["x-goog-api-key"], "second-key");
    assert.match(spoken.request.url.pathname, /\/models\/gemini-3\.8-flash-lite-tts:streamGenerateContent$/);
    assert.equal(JSON.parse(spoken.request.options.body).generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, "Puck");
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    process.env.GEMINI_TTS_MODEL = "gemini-3.8-flash-tts";
    process.env.GEMINI_TTS_VOICE = "Charon";
    spoken = await speak();
    assert.equal(spoken.request.options.headers["x-goog-api-key"], "third-key");
    assert.match(spoken.request.url.pathname, /\/models\/gemini-3\.8-flash-tts:streamGenerateContent$/);
    assert.equal(JSON.parse(spoken.request.options.body).generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, "Charon");
    delete process.env.GOOGLE_API_KEY;
    spoken = await speak();
    assert.equal(spoken.mimeType, "audio/mpeg", "gemini without a key falls back to Deepgram");
    assert.equal(spoken.request.url.hostname, "api.deepgram.com");

    process.env.MING_TTS_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "openai-env-key";
    spoken = await speak();
    assert.equal(spoken.mimeType, "audio/L16; rate=24000; channels=1");
    assert.equal(spoken.request.url.href, "https://api.openai.com/v1/audio/speech");
    assert.equal(spoken.request.options.headers.Authorization, "Bearer openai-env-key");
    let openaiBody = JSON.parse(spoken.request.options.body);
    assert.equal(openaiBody.model, "gpt-4o-mini-tts");
    assert.equal(openaiBody.voice, "cedar");
    process.env.OPENAI_TTS_MODEL = "gpt-4o-mini-tts-2025-12-15";
    process.env.OPENAI_TTS_VOICE = "ash";
    openaiBody = JSON.parse((await speak()).request.options.body);
    assert.equal(openaiBody.model, "gpt-4o-mini-tts-2025-12-15");
    assert.equal(openaiBody.voice, "ash");
    delete process.env.OPENAI_API_KEY;
    spoken = await speak();
    assert.equal(spoken.mimeType, "audio/mpeg", "openai without a key falls back to Deepgram");
    assert.equal(spoken.request.url.hostname, "api.deepgram.com");
  } finally {
    for (const [name, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

const heard = (f) => f.requests.filter((r) => /listen|transcriptions/.test(r.url.pathname)).map((r) => r.url.hostname);
const openaiStt = (overrides = {}) => fixture({ sttProvider: () => "openai", openaiApiKey: () => openaiKey, ...overrides });

test("OpenAI STT is opt-in: an unset, deepgram or unknown provider, or no OpenAI key, transcribes with Deepgram only", async () => {
  for (const [provider, key] of [[undefined, openaiKey], ["deepgram", openaiKey], ["openai-stt", openaiKey], ["openai", undefined], ["openai", " "]]) {
    const f = fixture({ sttProvider: () => provider, openaiApiKey: () => key });
    const result = await f.service.turn(recording(), "owner");
    assert.equal(result.messages[0].content, "I would like to help you improve.", String(provider));
    assert.deepEqual(heard(f), ["api.deepgram.com"], String(provider) + " / " + String(key));
  }
});

test("OpenAI STT uploads the recording as a named file with the model and Bearer key, and its words become the user message", async () => {
  const f = openaiStt({ sttProvider: () => " OpenAI " });
  const input = recording();
  const result = await f.service.turn(input, "owner");
  assert.equal(result.messages[0].content, "Words heard by OpenAI.");
  assert.deepEqual(heard(f), [openaiHost], "Deepgram is not asked to transcribe when OpenAI answers");
  const [call] = f.requests;
  assert.equal(call.url.href, "https://api.openai.com/v1/audio/transcriptions");
  assert.deepEqual(call.options.headers, { Authorization: "Bearer " + openaiKey });
  assert.doesNotMatch(JSON.stringify(call.options.headers), new RegExp(secret), "the Deepgram key never goes to OpenAI");
  assert.equal(call.options.redirect, "error");
  assert.ok(call.options.signal instanceof AbortSignal);
  const file = call.options.body.get("file");
  assert.equal(file.name, "turn.webm");
  assert.equal(file.type, "audio/webm;codecs=opus");
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), Buffer.from(input.audioBase64, "base64"));
  assert.equal(call.options.body.get("model"), "gpt-transcribe");

  for (const [mimeType, name] of [["audio/mp4", "turn.mp4"], ["audio/wav", "turn.wav"], ["audio/x-wav", "turn.wav"]]) {
    const g = openaiStt({ openaiSttModel: () => " gpt-transcribe-2026 " });
    await g.service.turn(recording({ mimeType }), "owner");
    assert.equal(g.requests[0].options.body.get("file").name, name, mimeType);
    assert.equal(g.requests[0].options.body.get("model"), "gpt-transcribe-2026");
  }
});

test("OpenAI STT failures fall back to Deepgram for that same turn and never relay OpenAI bodies", async () => {
  let cancelled = 0;
  const failures = {
    "429 quota": () => new Response(new ReadableStream({
      start: (c) => { c.enqueue(new TextEncoder().encode(secret)); c.close(); },
      cancel: () => { cancelled++; },
    }), { status: 429 }),
    "500": () => Response.json({ error: { message: secret } }, { status: 500 }),
    "network error": async () => { throw new Error(secret); },
    "malformed JSON": () => new Response("{" + secret),
    "wrong shape": () => Response.json({ transcript: secret }),
    "oversized body": () => Response.json({ text: "x".repeat(300 * 1024) }),
  };
  for (const [name, failure] of Object.entries(failures)) {
    const f = openaiStt({ openaiStt: failure });
    const result = await f.service.turn(recording(), "owner");
    assert.equal(result.status, "success", name);
    assert.equal(result.messages[0].content, "I would like to help you improve.", name);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(secret), name);
    assert.deepEqual(heard(f), [openaiHost, "api.deepgram.com"], name);
  }
  assert.equal(cancelled, 1, "the 429 body is cancelled, never read");
});

test("silence from OpenAI is an answer, not a failure, and ogg recordings skip OpenAI", async () => {
  const quiet = openaiStt({ openaiStt: () => Response.json({ text: "  " }) });
  await assert.rejects(quiet.service.turn(recording(), "owner"), (e) => e.status === 400 && /No speech/.test(e.message));
  assert.deepEqual(heard(quiet), [openaiHost], "an empty transcript is not sent to Deepgram again");
  // OpenAI documents webm, mp4 and wav, not Firefox's ogg.
  const firefox = openaiStt();
  const result = await firefox.service.turn(recording({ mimeType: "audio/ogg;codecs=opus" }), "owner");
  assert.equal(result.messages[0].content, "I would like to help you improve.");
  assert.deepEqual(heard(firefox), ["api.deepgram.com"]);
});

test("server adapter reads MING_STT_PROVIDER, OPENAI_STT_MODEL and OPENAI_API_KEY from env", async () => {
  const envNames = ["MING_STT_PROVIDER", "OPENAI_STT_MODEL", "OPENAI_API_KEY", "MING_TEXT_PROVIDER"];
  const original = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  const requests = [];
  const { deepgramVoice } = loadBackendSource("src/backend/src/mastra/deepgramVoice.ts", {
    "@mastra/core/agent": { Agent: class { async generateVNext() { return { text: "A spoken reply." }; } } },
    "../lib/deepgramVoice": { createDeepgramVoiceService: (dependencies) => createDeepgramVoiceService({
      ...dependencies,
      apiKey: () => secret,
      request: async (url, options) => {
        requests.push({ url: new URL(url), options });
        return new URL(url).pathname.endsWith("/audio/transcriptions") ? Response.json({ text: "Heard by OpenAI." }) : transcript();
      },
    }) },
    "../lib/prompts": loadBackendSource("src/backend/src/lib/prompts.ts"),
    "../lib/providers": loadBackendSource("src/backend/src/lib/providers.ts"),
    "../lib/security": { reserveGeneration: () => () => {} },
    "../lib/voice": voice,
    "./agents/defaultAgent": { defaultAgent: { getMemory: async () => ({
      getThreadById: async () => ({ resourceId: "owner" }),
      saveMessages: async () => {},
    }) } },
    "./models": { isTextConfigured: () => true, textModel: {} },
  });
  const listen = async () => {
    requests.length = 0;
    const result = await deepgramVoice.turn(recording(), "owner");
    return { text: result.messages[0].content, request: requests[0] };
  };
  try {
    for (const name of envNames) delete process.env[name];
    process.env.OPENAI_API_KEY = "env-openai-key";
    assert.equal((await listen()).request.url.hostname, "api.deepgram.com", "unset provider means Deepgram");
    process.env.MING_STT_PROVIDER = "openai";
    let heardBy = await listen();
    assert.equal(heardBy.text, "Heard by OpenAI.");
    assert.equal(heardBy.request.options.headers.Authorization, "Bearer env-openai-key");
    assert.equal(heardBy.request.options.body.get("model"), "gpt-transcribe");
    process.env.OPENAI_STT_MODEL = "gpt-transcribe-next";
    assert.equal((await listen()).request.options.body.get("model"), "gpt-transcribe-next");
    delete process.env.OPENAI_API_KEY;
    heardBy = await listen();
    assert.equal(heardBy.request.url.hostname, "api.deepgram.com", "openai without a key falls back to Deepgram");
  } finally {
    for (const [name, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
