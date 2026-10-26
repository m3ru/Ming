import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import { loadBackendSource } from "./backend-runtime.mjs";

const output = mkdtempSync(join(tmpdir(), "ming-deepgram-controller-"));
const target = join(output, "deepgramVoice.cjs");
writeFileSync(
  target,
  ts.transpileModule(
    readFileSync(
      new URL("../src/lib/deepgramVoice.ts", import.meta.url),
      "utf8",
    ),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
      },
    },
  ).outputText,
);
const { DeepgramVoiceController } = createRequire(import.meta.url)(target);
test("fresh recovery controls render without compiling browser-only Cedar context", () => {
  const controller = new DeepgramVoiceController({
    scope: () => { throw new ReferenceError("Element is not defined"); },
  });
  assert.equal(controller.canContinueByText(), false);
  assert.equal(controller.getSnapshot().canContinueByText, false);
});
after(() => rmSync(output, { recursive: true, force: true }));
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function until(predicate) {
  for (let i = 0; i < 100 && !predicate(); i++) await tick();
  assert.ok(predicate(), "condition was not reached");
}
const errors = loadBackendSource("src/lib/chatErrors.ts");
const { buildReportTranscript } = loadBackendSource(
  "src/lib/reportTranscript.ts",
  {
    "./chatErrors": errors,
  },
);
// Run the actual input's submit/recovery handlers with the real voice controller.
// Only React rendering, editor APIs, and the typed transport are stand-ins.
function chatInput(env, { props = {}, effects, send } = {}) {
  let submit;
  let cleared = 0;
  let sent = 0;
  let draftUpdates = 0;
  const errorsShown = [];
  const editor = {
    getJSON: () => ({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Typed fallback" }],
        },
      ],
    }),
    commands: { focus() {} },
    isDestroyed: false,
  };
  const state = {
    mainThreadId: env.currentThread(),
    isProcessing: false,
    messages: env.getHistory(),
    getCurrentThreadId: env.currentThread,
    getCedarState: () => "user-1",
    getThreadMessages: () => env.getHistory(),
    setChatInputContent() {
      draftUpdates++;
    },
    updateMessage(id, patch) {
      env.history(env.getHistory().map((message) => (message.id === id ? { ...message, ...patch } : message)));
    },
    async sendMessage() {
      sent++;
      if (send) return send();
      env.history([
        ...env.getHistory(),
        {
          id: "typed-user",
          type: "text",
          role: "user",
          content: "Typed fallback",
        },
        {
          id: "typed-assistant",
          type: "text",
          role: "assistant",
          content: "Typed reply",
        },
      ]);
    },
  };
  const cedar = Object.assign((select) => select(state), {
    getState: () => state,
  });
  const react = {
    createElement: (type, props, ...children) => ({
      type,
      props: { ...props, children },
    }),
    useEffect: (effect, deps) => effects?.push({ effect, deps }),
    useState: (value) => [value, (next) => errorsShown.push(next)],
    useRef: (value) => ({ current: value }),
  };
  const mocks = {
    react: { __esModule: true, default: react, ...react },
    "cedar-os": {
      cn: (...values) => values.join(" "),
      useCedarStore: cedar,
      useCedarEditor: (options) => {
        submit = options.onSubmit;
        return { editor, isEditorEmpty: false, handleSubmit() {} };
      },
      CedarEditorContent: () => null,
    },
    "lucide-react": {},
    "motion/react": { motion: { div: "div" } },
    "./ChatInput.css": {},
    "@/cedar/components/chatInput/ContextBadgeRow": {},
    "@/cedar/components/chatInput/HumanInTheLoopIndicator": {},
    "@/hooks/useVoiceSession": {
      useVoiceSession: () => ({
        ...env.controller.getSnapshot(),
        provider: "deepgram",
        start: env.controller.start,
        flush: env.controller.flush,
        beginTalking: env.controller.beginTalking,
        endTalking: env.controller.endTalking,
        canContinueByText: env.controller.canContinueByText(),
        continueByText: env.controller.continueByText,
      }),
    },
    "@/lib/chatErrors": errors,
    "@/lib/chatStreamObserver": {},
  };
  const compiled = ts.transpileModule(
    readFileSync(
      new URL(
        "../src/cedar/components/chatInput/ChatInput.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.React,
        esModuleInterop: true,
      },
    },
  ).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", compiled)(
    (id) => {
      assert.ok(Object.hasOwn(mocks, id), "unexpected ChatInput import: " + id);
      return mocks[id];
    },
    loaded,
    loaded.exports,
  );
  const tree = loaded.exports.ChatInput({ stream: false, ...props });
  const findRecovery = (node) => {
    if (!node || typeof node !== "object") return;
    if (
      node.type === "button" &&
      node.props.children.includes("Continue by text")
    )
      return node;
    return node.props?.children.flat(Infinity).map(findRecovery).find(Boolean);
  };
  return {
    submit: () => submit("Typed fallback", editor, () => cleared++),
    recover: () => findRecovery(tree)?.props.onClick(),
    hasRecovery: () => Boolean(findRecovery(tree)),
    sent: () => sent,
    cleared: () => cleared,
    draftUpdates: () => draftUpdates,
    errors: () => errorsShown,
  };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, failed) => {
    resolve = done;
    reject = failed;
  });
  return { promise, resolve, reject };
}
function voiceMessage(body, role, content) {
  const sessionId = "deepgram-" + body.turnId;
  return {
    id: "voice-" + sessionId + "-" + role,
    role,
    content:
      content ?? (role === "user" ? "Actual recognized words" : "Saved response"),
    createdAt:
      role === "user" ? "2026-10-25T10:00:00.000Z" : "2026-10-25T10:00:01.000Z",
  };
}
function done(body, extra = {}) {
  return {
    type: "done",
    status: "success",
    persisted: true,
    sessionId: "deepgram-" + body.turnId,
    ...extra,
  };
}
// Deliver NDJSON in small byte chunks so every line crosses a chunk boundary.
function ndjson(lines, size = 7) {
  const bytes = new TextEncoder().encode(
    lines.map((line) => JSON.stringify(line) + "\n").join(""),
  );
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let offset = 0; offset < bytes.length; offset += size)
          controller.enqueue(bytes.slice(offset, offset + size));
        controller.close();
      },
    }),
    { headers: { "Content-Type": "application/x-ndjson" } },
  );
}
function success(body, { roles = ["user", "assistant"], ...extra } = {}) {
  return ndjson([
    ...roles.map((role) => ({
      type: "message",
      message: voiceMessage(body, role),
    })),
    done(body, extra),
  ]);
}
const mp3 = (body = "synthetic mp3 bytes") =>
  new Response(body, { headers: { "Content-Type": "audio/mpeg" } });
function setup(t, options = {}) {
  const tracks = [];
  const recordings = [];
  const audioElements = [];
  const requests = [];
  const speeches = [];
  const objects = [];
  const transcripts = [];
  const revoked = [];
  let currentThread = "thread-1";
  let context = { scenario: "first" };
  let history = [];
  let permissionCalls = 0;
  class Recorder {
    state = "inactive";
    ondataavailable = null;
    onstop = null;
    onerror = null;
    stopped = 0;
    static isTypeSupported(type) {
      return type === "audio/webm;codecs=opus";
    }
    constructor(stream, config) {
      this.stream = stream;
      this.mimeType = config.mimeType;
      recordings.push(this);
    }
    start() {
      this.state = "recording";
    }
    stop() {
      this.state = "inactive";
      this.stopped++;
      if (!options.holdFinal) queueMicrotask(() => this.finish());
    }
    data(value = "recorded final chunk") {
      this.ondataavailable?.({
        data: new Blob([value], { type: this.mimeType }),
      });
    }
    finish() {
      this.data();
      this.onstop?.();
    }
  }
  class Audio {
    paused = true;
    muted = false;
    onplaying = null;
    onpause = null;
    onended = null;
    onerror = null;
    constructor() {
      audioElements.push(this);
    }
    async play() {
      if (options.blockPlayback && !this.allowed)
        throw new Error("Autoplay denied");
      this.paused = false;
      this.onplaying?.();
    }
    pause() {
      this.paused = true;
      this.onpause?.();
    }
    removeAttribute() {
      this.src = "";
    }
    load() {}
  }
  const microphone = () => {
    const track = {
      enabled: true,
      stopped: false,
      stop() {
        this.stopped = true;
      },
    };
    tracks.push(track);
    return { getTracks: () => [track], getAudioTracks: () => [track] };
  };
  for (const [key, value] of Object.entries({
    navigator: {
      mediaDevices: {
        getUserMedia: async () => {
          permissionCalls++;
          return options.permission
            ? options.permission(microphone)
            : microphone();
        },
      },
    },
    MediaRecorder: Recorder,
    Audio,
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, key, previous);
      else delete globalThis[key];
    });
  }
  t.mock.method(URL, "createObjectURL", (object) => {
    objects.push(object);
    return "blob:test-" + objects.length;
  });
  t.mock.method(URL, "revokeObjectURL", (url) => revoked.push(url));
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const body = JSON.parse(init.body);
    const request = { url: String(url), body, signal: init.signal };
    if (request.url.endsWith("/voice/deepgram/speech")) {
      speeches.push(request);
      return options.speech ? options.speech(request, speeches.length) : mp3();
    }
    requests.push(request);
    return options.request
      ? options.request(request, requests.length)
      : success(body);
  });
  const controller = new DeepgramVoiceController({
    baseURL: () => "/api/backend/",
    scope: () => ({
      threadId: currentThread,
      resourceId: "user-1",
      context,
      messages: history,
    }),
    messages: () => history,
    transcript: (threadId, sessionId, messages) => {
      transcripts.push({ threadId, sessionId, messages });
      history = [
        ...history.filter((item) => item.metadata?.sessionId !== sessionId),
        ...messages,
      ];
    },
  });
  t.after(() => controller.dispose());
  return {
    controller,
    recordings,
    tracks,
    requests,
    speeches,
    objects,
    transcripts,
    // Each turn reports [user] then [user, assistant] under one session ID.
    sessions: () => new Set(transcripts.map(({ sessionId }) => sessionId)).size,
    audioElements,
    revoked,
    microphone,
    permissionCalls: () => permissionCalls,
    context: (value) => {
      context = value;
    },
    history: (value) => {
      history = value;
    },
    getHistory: () => history,
    thread: (value) => {
      currentThread = value;
    },
    currentThread: () => currentThread,
  };
}

test("stop waits for the final recorder chunk and persisted response before completing", async (t) => {
  const response = deferred();
  const env = setup(t, { holdFinal: true, request: () => response.promise });
  await env.controller.start();
  assert.equal(
    env.permissionCalls(),
    0,
    "preparing voice does not capture the microphone",
  );
  await env.controller.beginTalking();
  assert.equal(env.tracks[0].enabled, true);
  let stopped = false;
  const stop = env.controller.stop().then(() => {
    stopped = true;
  });
  await tick();
  assert.equal(env.tracks[0].enabled, false);
  assert.equal(stopped, false);
  assert.equal(env.requests.length, 0);
  env.recordings[0].finish();
  await tick();
  assert.equal(env.requests.length, 1);
  assert.equal(
    Buffer.from(env.requests[0].body.audioBase64, "base64").toString(),
    "recorded final chunk",
  );
  assert.equal(stopped, false);
  response.resolve(success(env.requests[0].body));
  await stop;
  assert.equal(env.sessions(), 1);
  assert.equal(env.tracks[0].stopped, true);
  assert.equal(env.controller.getSnapshot().status, "idle");
});

test("flush finalizes a held turn with latest typed history and context; unique turn IDs retain earlier messages", async (t) => {
  const env = setup(t);
  await env.controller.beginTalking();
  env.context({ scenario: "updated" });
  env.history([
    {
      id: "typed-1",
      role: "user",
      content: "Typed update",
      createdAt: "2026-10-25T09:00:00.000Z",
    },
  ]);
  env.controller.syncContext();
  env.controller.syncTypedMessages();
  await env.controller.flush();
  assert.deepEqual(env.requests[0].body.context, { scenario: "updated" });
  assert.equal(env.requests[0].body.messages[0].content, "Typed update");
  assert.equal(env.tracks[0].enabled, false);
  assert.equal(env.tracks[0].stopped, false);
  await env.controller.beginTalking();
  await env.controller.flush();
  assert.equal(env.sessions(), 2);
  assert.notEqual(env.transcripts[0].sessionId, env.transcripts.at(-1).sessionId);
  assert.equal(env.getHistory().length, 5);
  assert.ok(
    env.transcripts.every(({ messages }) =>
      messages.every((item) => item.metadata.source === "live-voice"),
    ),
  );
});

test("a partial generation/TTS failure keeps recognized text and does not block report finalization", async (t) => {
  const env = setup(t, {
    request: ({ body }) =>
      success(body, {
        roles: ["user"],
        status: "partial",
        error: "The AI could not respond. Your words are saved.",
      }),
  });
  await env.controller.beginTalking();
  await env.controller.flush();
  assert.equal(env.transcripts[0].messages.length, 1);
  assert.equal(
    env.transcripts[0].messages[0].content,
    "Actual recognized words",
  );
  assert.match(env.controller.getSnapshot().error, /words are saved/);
  await env.controller.stop();
  assert.equal(env.requests.length, 1);
  assert.equal(env.speeches.length, 0, "a reply that was never saved is never spoken");
});

test("failed transcript persistence rejects completion, then retries the exact request and ID", async (t) => {
  const env = setup(t, {
    request: ({ body }, count) =>
      count === 1
        ? ndjson([
            done(body, {
              status: "partial",
              persisted: false,
              error: "Could not save your transcript.",
            }),
          ])
        : success(body),
  });
  await env.controller.beginTalking();
  await assert.rejects(env.controller.stop(), /Could not save/);
  assert.equal(env.transcripts.length, 0);
  await env.controller.stop();
  assert.equal(env.requests.length, 2);
  assert.deepEqual(env.requests[0].body, env.requests[1].body);
  assert.equal(env.sessions(), 1);
});

test("a provider failure does not invent text and a later flush recovers a network-ambiguous turn", async (t) => {
  const env = setup(t, {
    request: ({ body }, count) =>
      count === 1
        ? Response.json(
            { error: "Deepgram is unavailable. Try again." },
            { status: 503 },
          )
        : success(body),
  });
  await env.controller.beginTalking();
  await assert.rejects(env.controller.flush(), /unavailable/);
  assert.deepEqual(env.transcripts, []);
  await env.controller.flush();
  assert.equal(env.sessions(), 1);
  assert.deepEqual(env.requests[0].body, env.requests[1].body);
  assert.equal(env.controller.getSnapshot().error, null);
});

test("explicit text recovery releases a persistent STT failure without retrying or losing saved dialogue", async (t) => {
  const env = setup(t, {
    request: ({ body }, count) =>
      count === 1
        ? success(body)
        : Response.json(
            { error: "The recording could not be transcribed." },
            { status: 502 },
          ),
  });
  await env.controller.beginTalking();
  await env.controller.flush();
  const saved = structuredClone(env.getHistory());
  await env.controller.beginTalking();
  await assert.rejects(env.controller.flush(), /Continue by text/);
  assert.equal(env.controller.canContinueByText(), true);
  // Retry is still the default until the user explicitly discards the clip.
  await assert.rejects(env.controller.stop(), /could not be transcribed/);
  assert.deepEqual(env.requests[1].body, env.requests[2].body);
  assert.equal(env.controller.getSnapshot().status, "idle");
  assert.equal(env.controller.canContinueByText(), true);
  const input = chatInput(env);
  assert.equal(input.hasRecovery(), true);
  await input.submit();
  assert.equal(
    input.sent(),
    0,
    "a retained failed clip still blocks sending until explicit recovery",
  );
  assert.equal(input.cleared(), 0, "the input retains the typed draft");
  assert.ok(
    input
      .errors()
      .some(
        (value) =>
          typeof value === "string" && value.includes("Continue by text"),
      ),
  );
  input.recover();
  await tick();
  assert.equal(env.controller.canContinueByText(), false);
  assert.equal(env.controller.getSnapshot().error, null);
  assert.deepEqual(env.getHistory(), saved);
  await input.submit();
  assert.equal(
    input.sent(),
    1,
    "the real input handler reaches typed transport",
  );
  assert.equal(
    input.cleared(),
    1,
    "a successful typed fallback clears the draft",
  );
  await env.controller.stop();
  const transcript = buildReportTranscript(
    env.getHistory().map((item) => ({ ...item, type: "text" })),
  );
  assert.match(transcript, /Actual recognized words/);
  assert.match(transcript, /Typed fallback/);
  assert.match(transcript, /Typed reply/);
  assert.deepEqual(env.getHistory().slice(0, saved.length), saved);
  assert.equal(
    env.requests.length,
    4,
    "text and report finalization do not re-run STT after recovery",
  );
  assert.equal(
    env.sessions(),
    1,
    "saved dialogue is not inserted again",
  );
  assert.equal(env.tracks[0].stopped, true);
});

test("text recovery cannot discard an in-flight retry or its eventual saved transcript", async (t) => {
  const response = deferred();
  const env = setup(t, {
    request: (_request, count) =>
      count === 1
        ? Response.json({ error: "Temporary STT failure" }, { status: 502 })
        : response.promise,
  });
  await env.controller.beginTalking();
  await assert.rejects(env.controller.flush(), /Temporary STT failure/);
  assert.equal(env.controller.canContinueByText(), true);
  const retry = env.controller.flush();
  await tick();
  assert.equal(env.controller.canContinueByText(), false);
  await assert.rejects(
    env.controller.continueByText(),
    /Wait for the voice turn/,
  );
  response.resolve(success(env.requests[1].body));
  await retry;
  assert.equal(env.sessions(), 1);
  assert.equal(env.controller.canContinueByText(), false);
  await env.controller.stop();
  assert.equal(env.requests.length, 2);
});

test("concurrent flush and stop share a disconnected retry and preserve its one saved transcript", async (t) => {
  const response = deferred();
  const env = setup(t, {
    request: (_request, count) =>
      count === 1
        ? Response.json({ error: "STT unavailable" }, { status: 502 })
        : response.promise,
  });
  await env.controller.beginTalking();
  await assert.rejects(env.controller.stop(), /STT unavailable/);
  const flush = env.controller.flush();
  const stop = env.controller.stop();
  await tick();
  assert.equal(env.requests.length, 2);
  assert.equal(env.controller.canContinueByText(), false);
  await assert.rejects(
    env.controller.continueByText(),
    /Wait for the voice turn/,
  );
  response.resolve(success(env.requests[1].body));
  await Promise.all([flush, stop]);
  assert.equal(env.sessions(), 1);
});

test("a typed submit awaiting voice completion cannot send its draft into a different thread", async (t) => {
  const response = deferred();
  const env = setup(t, { request: () => response.promise });
  await env.controller.beginTalking();
  const input = chatInput(env);
  const submit = input.submit();
  await tick();
  env.thread("thread-2");
  response.resolve(success(env.requests[0].body));
  await submit;
  assert.equal(input.sent(), 0);
  assert.equal(input.cleared(), 0);
  assert.equal(
    input.draftUpdates(),
    0,
    "the old editor does not write a draft into the new thread",
  );
  assert.ok(
    input
      .errors()
      .some(
        (value) =>
          typeof value === "string" && value.includes("conversation changed"),
      ),
  );
  assert.equal(env.transcripts[0].threadId, "thread-1");
});

test("text recovery is scoped to the failed conversation and permits a fresh voice turn later", async (t) => {
  const env = setup(t, {
    request: ({ body }, count) =>
      count <= 2
        ? Response.json({ error: "STT unavailable" }, { status: 502 })
        : success(body),
  });
  await env.controller.beginTalking();
  await assert.rejects(env.controller.stop(), /STT unavailable/);
  env.thread("thread-2");
  assert.equal(env.controller.canContinueByText(), false);
  await assert.rejects(
    env.controller.continueByText(),
    /Wait for the voice turn/,
  );
  await env.controller.flush();
  assert.equal(
    env.requests.length,
    1,
    "another thread does not retry the failed clip",
  );
  env.thread("thread-1");
  assert.equal(env.controller.canContinueByText(), true);
  await env.controller.continueByText();
  await env.controller.beginTalking();
  await assert.rejects(env.controller.flush(), /STT unavailable/);
  assert.notEqual(env.requests[0].body.turnId, env.requests[1].body.turnId);
  await env.controller.continueByText();
  await env.controller.beginTalking();
  await env.controller.flush();
  assert.equal(env.sessions(), 1);
  assert.notEqual(env.requests[1].body.turnId, env.requests[2].body.turnId);
});

test("a silent rejected clip permits a fresh recording with a new turn ID", async (t) => {
  const env = setup(t, {
    request: ({ body }, count) =>
      count === 1
        ? Response.json(
            { error: "No speech was recognized. Please record again." },
            { status: 400 },
          )
        : success(body),
  });
  await env.controller.beginTalking();
  await assert.rejects(env.controller.flush(), /No speech/);
  assert.equal(env.transcripts.length, 0);
  await env.controller.beginTalking();
  await env.controller.flush();
  assert.equal(env.requests.length, 2);
  assert.notEqual(env.requests[0].body.turnId, env.requests[1].body.turnId);
  assert.equal(env.sessions(), 1);
  await env.controller.stop();
});

test("retry payload remains unchanged even if original context or message objects mutate", async (t) => {
  const env = setup(t, {
    request: ({ body }, count) =>
      count === 1
        ? Response.json({ error: "Temporary failure" }, { status: 503 })
        : success(body),
  });
  const context = { nested: { scenario: "first" } };
  const typed = {
    id: "typed-1",
    role: "user",
    content: "Original",
    createdAt: "2026-10-25T09:00:00.000Z",
  };
  env.context(context);
  env.history([typed]);
  await env.controller.beginTalking();
  await assert.rejects(env.controller.flush(), /Temporary/);
  context.nested.scenario = "changed";
  typed.content = "Changed";
  await env.controller.flush();
  assert.deepEqual(env.requests[0].body, env.requests[1].body);
});

test("microphone denial stays muted and a quick release during permission setup never records", async (t) => {
  const denied = setup(t, {
    permission: async () => {
      throw new DOMException("Microphone permission denied", "NotAllowedError");
    },
  });
  await denied.controller.beginTalking();
  assert.equal(denied.controller.getSnapshot().muted, true);
  assert.match(denied.controller.getSnapshot().error, /permission denied/);
  assert.equal(denied.recordings.length, 0);
  denied.controller.dispose();
});

test("release and stop while microphone permission is pending clean up late tracks", async (t) => {
  const permission = deferred();
  const env = setup(t, { permission: () => permission.promise });
  const start = env.controller.beginTalking();
  await tick();
  env.controller.endTalking();
  await env.controller.stop();
  permission.resolve(env.microphone());
  await start;
  assert.equal(env.recordings.length, 0);
  assert.equal(env.requests.length, 0);
  assert.equal(env.tracks[0].enabled, false);
  assert.equal(env.tracks[0].stopped, true);
});

test("quick release before permission resolves leaves tracks disabled until a new press", async (t) => {
  const permission = deferred();
  const env = setup(t, { permission: () => permission.promise });
  const start = env.controller.beginTalking();
  await tick();
  env.controller.endTalking();
  permission.resolve(env.microphone());
  await start;
  assert.equal(env.recordings.length, 0);
  assert.equal(env.tracks[0].enabled, false);
  await env.controller.beginTalking();
  assert.equal(env.recordings.length, 1);
  await env.controller.stop();
});

test("pressing while a turn is processing reports busy and cannot start a second recording", async (t) => {
  const response = deferred();
  const env = setup(t, { request: () => response.promise });
  await env.controller.beginTalking();
  env.controller.endTalking();
  await tick();
  await env.controller.beginTalking();
  assert.match(env.controller.getSnapshot().error, /previous turn/);
  assert.equal(env.recordings.length, 1);
  response.resolve(success(env.requests[0].body));
  await env.controller.flush();
});

test("dispose aborts the request and drops a late response even when fetch ignores its signal", async (t) => {
  const response = deferred();
  const env = setup(t, { request: () => response.promise });
  await env.controller.beginTalking();
  env.controller.endTalking();
  await tick();
  env.controller.dispose();
  assert.equal(env.requests[0].signal.aborted, true);
  response.resolve(success(env.requests[0].body));
  await tick();
  assert.equal(env.transcripts.length, 0);
  assert.equal(env.audioElements.length, 0);
  assert.equal(env.speeches.length, 0);
  assert.equal(env.tracks[0].stopped, true);
  assert.equal(env.controller.getSnapshot().status, "idle");
});

test("a thread switch preserves the old thread scope and does not play its late audio", async (t) => {
  const response = deferred();
  const env = setup(t, { request: () => response.promise });
  await env.controller.beginTalking();
  env.controller.endTalking();
  await tick();
  env.thread("thread-2");
  const stop = env.controller.stop();
  response.resolve(success(env.requests[0].body));
  await stop;
  assert.equal(env.transcripts.at(-1).threadId, "thread-1");
  assert.equal(env.audioElements.length, 0);
  assert.equal(env.speeches.length, 0);
  assert.equal(env.requests[0].body.threadId, "thread-1");
});

test("blocked audio can resume; speaking reflects playback and object URLs are revoked", async (t) => {
  const env = setup(t, { blockPlayback: true });
  await env.controller.beginTalking();
  await env.controller.flush();
  await until(() => env.controller.getSnapshot().playbackBlocked);
  assert.equal(env.controller.getSnapshot().speaking, false);
  assert.equal(env.controller.getSnapshot().playbackBlocked, true);
  env.audioElements[0].allowed = true;
  await env.controller.resumePlayback();
  assert.equal(env.controller.getSnapshot().playbackBlocked, false);
  assert.equal(env.controller.getSnapshot().speaking, true);
  env.audioElements[0].pause();
  assert.equal(env.controller.getSnapshot().speaking, false);
  env.audioElements[0].onended();
  assert.equal(env.revoked.length, 1);
  await env.controller.stop();
  assert.equal(env.revoked.length, 1, "a URL is only released once");
});

test("oversize recordings stop locally without uploading incomplete audio", async (t) => {
  const env = setup(t);
  await env.controller.beginTalking();
  env.recordings[0].data(new Uint8Array(512 * 1024 + 1));
  await assert.rejects(env.controller.flush(), /too large/);
  assert.equal(env.tracks[0].enabled, false);
  assert.equal(env.requests.length, 0);
  assert.equal(env.transcripts.length, 0);
});

test("the thirty-second limit releases capture and visibly reports the clip limit", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const response = deferred();
  const env = setup(t, { request: () => response.promise });
  await env.controller.beginTalking();
  t.mock.timers.tick(30_000);
  assert.equal(env.tracks[0].enabled, false);
  assert.equal(env.recordings[0].stopped, 1);
  assert.match(env.controller.getSnapshot().error, /30 seconds/);
  await tick();
  assert.equal(env.requests.length, 1);
  response.resolve(success(env.requests[0].body));
  await env.controller.flush();
});

function controlled() {
  let stream;
  const response = new Response(
    new ReadableStream({
      start(controller) {
        stream = controller;
      },
    }),
    { headers: { "Content-Type": "application/x-ndjson" } },
  );
  return {
    response,
    bytes: (value) => stream.enqueue(new TextEncoder().encode(value)),
    raw: (value) => stream.enqueue(value),
    line: (value) =>
      stream.enqueue(new TextEncoder().encode(JSON.stringify(value) + "\n")),
    close: () => stream.close(),
  };
}

test("the user's words show as soon as they are saved, before Bart's reply, across split UTF-8 chunks", async (t) => {
  const upstream = controlled();
  const env = setup(t, { request: () => upstream.response });
  await env.controller.beginTalking();
  const flush = env.controller.flush();
  await until(() => env.requests.length === 1);
  const body = env.requests[0].body;
  const user = JSON.stringify({
    type: "message",
    message: voiceMessage(body, "user", "Café ☕ words"),
  });
  // One byte at a time splits the line and both multi-byte characters.
  for (const byte of new TextEncoder().encode(user + "\n"))
    upstream.raw(new Uint8Array([byte]));
  await until(() => env.transcripts.length === 1);
  assert.deepEqual(
    env.transcripts[0].messages.map((m) => [m.role, m.content]),
    [["user", "Café ☕ words"]],
  );
  assert.equal(env.controller.getSnapshot().working, true, "Bart is still replying");
  assert.equal(env.speeches.length, 0);
  upstream.line({ type: "message", message: voiceMessage(body, "assistant") });
  upstream.line(done(body));
  upstream.close();
  await flush;
  assert.deepEqual(
    env.transcripts.map(({ messages }) => messages.map((m) => m.role)),
    [["user"], ["user", "assistant"]],
  );
  assert.equal(env.transcripts[0].sessionId, env.transcripts[1].sessionId);
  assert.equal(env.getHistory().length, 2, "the second report replaces the first");
  assert.equal(env.controller.getSnapshot().working, false);
  await until(() => env.speeches.length === 1);
});

test("error lines, a missing done and malformed streams fail the turn but keep the clip for an exact retry", async (t) => {
  const failures = [
    [(body) => ndjson([{ type: "message", message: voiceMessage(body, "user") }, { type: "error", status: 502, error: "The reply could not be generated." }]), /reply could not be generated/],
    [(body) => ndjson([{ type: "message", message: voiceMessage(body, "user") }]), /The voice request failed\. Please try again\./],
    [(body) => ndjson([done(body)]), /no saved transcript/],
    [(body) => ndjson([done(body, { sessionId: "deepgram-other" })]), /invalid response/],
    [(body) => ndjson([{ type: "message", message: { ...voiceMessage(body, "user"), id: "forged" } }, done(body)]), /invalid transcript/],
    [() => new Response("not json\n", { headers: { "Content-Type": "application/x-ndjson" } }), /invalid response/],
    [(body) => ndjson([done(body, { status: "partial", persisted: false, error: "Could not save your words." })]), /Could not save your words/],
  ];
  const env = setup(t, {
    request: ({ body }, count) =>
      count <= failures.length ? failures[count - 1][0](body) : success(body),
  });
  await env.controller.beginTalking();
  for (const [, expected] of failures) {
    await assert.rejects(env.controller.flush(), expected);
    assert.match(env.controller.getSnapshot().error, /Continue by text/);
    assert.equal(env.controller.canContinueByText(), true);
    assert.equal(env.speeches.length, 0);
  }
  await env.controller.flush();
  assert.equal(env.requests.length, failures.length + 1);
  assert.ok(env.requests.every(({ body }) => body.turnId === env.requests[0].body.turnId));
  assert.equal(env.sessions(), 1);
  assert.equal(env.controller.getSnapshot().error, null);
  await env.controller.stop();
});

test("speech posts the turn and plays the whole reply from a Blob when MediaSource is unavailable", async (t) => {
  const env = setup(t);
  await env.controller.beginTalking();
  await env.controller.flush();
  assert.equal(env.controller.getSnapshot().working, false, "the turn ends with Bart's text");
  await until(() => env.controller.getSnapshot().speaking);
  assert.match(env.speeches[0].url, /^\/api\/backend\/voice\/deepgram\/speech$/);
  assert.deepEqual(env.speeches[0].body, {
    turnId: env.requests[0].body.turnId,
    threadId: "thread-1",
  });
  assert.ok(env.objects[0] instanceof Blob);
  assert.equal(env.objects[0].type, "audio/mpeg");
  assert.equal(await env.objects[0].text(), "synthetic mp3 bytes");
  assert.equal(env.audioElements[0].src, "blob:test-1");
  env.audioElements[0].onended();
  assert.equal(env.controller.getSnapshot().speaking, false);
  assert.deepEqual(env.revoked, ["blob:test-1"]);
});

test("speech failures show an error and keep the saved text", async (t) => {
  const outcomes = [
    () => Response.json({ error: "This reply's audio was requested too many times. Its text is saved." }, { status: 429 }),
    () => { throw new TypeError("Failed to fetch"); },
    () => mp3(new Uint8Array(1024 * 1024 + 1)),
  ];
  const env = setup(t, { speech: (_request, count) => outcomes[count - 1]() });
  for (const expected of [/requested too many times/, /^The audio reply could not play\. Its text is saved\.$/, /too large to play/]) {
    await env.controller.beginTalking();
    await env.controller.flush();
    await until(() => expected.test(env.controller.getSnapshot().error ?? ""));
    assert.equal(env.controller.getSnapshot().speaking, false);
  }
  assert.equal(env.audioElements.length, 0);
  assert.equal(env.sessions(), 3, "every reply's text stays saved");
});

test("a new press and stop abort an in-flight speech request", async (t) => {
  const pending = [];
  const env = setup(t, {
    speech: () => {
      const response = deferred();
      pending.push(response);
      return response.promise;
    },
  });
  await env.controller.beginTalking();
  await env.controller.flush();
  await until(() => env.speeches.length === 1);
  await env.controller.beginTalking();
  assert.equal(env.speeches[0].signal.aborted, true, "talking over Bart stops his reply");
  await env.controller.flush();
  await until(() => env.speeches.length === 2);
  assert.equal(env.speeches[1].signal.aborted, false);
  await env.controller.stop();
  assert.equal(env.speeches[1].signal.aborted, true);
  pending.forEach((response) => response.resolve(mp3()));
  await tick();
  assert.equal(env.audioElements.length, 0, "late audio never plays");
  assert.equal(env.controller.getSnapshot().error, null);
});

test("with MediaSource, playback starts after the first chunk and the stream ends cleanly", async (t) => {
  class SourceBuffer extends EventTarget {
    appended = [];
    appendBuffer(chunk) {
      this.appended.push(Buffer.from(chunk).toString());
      setImmediate(() => this.dispatchEvent(new Event("updateend")));
    }
  }
  class MediaSource extends EventTarget {
    static isTypeSupported(type) {
      return type === "audio/mpeg";
    }
    ended = false;
    addSourceBuffer(type) {
      assert.equal(type, "audio/mpeg");
      return (this.buffer = new SourceBuffer());
    }
    endOfStream() {
      this.ended = true;
    }
  }
  Object.defineProperty(globalThis, "MediaSource", { configurable: true, value: MediaSource });
  t.after(() => delete globalThis.MediaSource);
  let audio;
  const env = setup(t, {
    speech: () => {
      audio = controlled();
      return new Response(audio.response.body, { headers: { "Content-Type": "audio/mpeg" } });
    },
  });
  await env.controller.beginTalking();
  await env.controller.flush();
  await until(() => env.objects.length === 1);
  const source = env.objects[0];
  assert.ok(source instanceof MediaSource);
  assert.equal(env.audioElements[0].src, "blob:test-1");
  source.dispatchEvent(new Event("sourceopen"));
  audio.bytes("first mp3 chunk");
  await until(() => env.controller.getSnapshot().speaking);
  assert.deepEqual(source.buffer.appended, ["first mp3 chunk"]);
  assert.equal(source.ended, false, "Bart speaks before the rest of the reply arrives");
  audio.bytes("second mp3 chunk");
  audio.close();
  await until(() => source.ended);
  assert.deepEqual(source.buffer.appended, ["first mp3 chunk", "second mp3 chunk"]);
  env.audioElements[0].onended();
  assert.deepEqual(env.revoked, ["blob:test-1"]);
});

// A minimal Web Audio stand-in: records what is scheduled, when, and what is torn down.
function webAudio(t, { state = "running" } = {}) {
  const contexts = [];
  class AudioBufferSourceNode {
    buffer = null;
    onended = null;
    stopped = false;
    connect(destination) {
      this.destination = destination;
    }
    start(when) {
      this.when = when;
    }
    stop() {
      this.stopped = true;
    }
  }
  class AudioContext {
    currentTime = 0;
    destination = { node: "speakers" };
    onstatechange = null;
    sources = [];
    closed = false;
    constructor() {
      this.state = state;
      contexts.push(this);
    }
    createBuffer(channels, length, sampleRate) {
      assert.equal(channels, 1);
      const data = new Float32Array(length);
      return { length, sampleRate, getChannelData: () => data };
    }
    createBufferSource() {
      const source = new AudioBufferSourceNode();
      this.sources.push(source);
      return source;
    }
    setState(state) {
      this.state = state;
      this.onstatechange?.();
    }
    async resume() {
      this.setState("running");
    }
    async close() {
      this.closed = true;
      this.state = "closed";
    }
  }
  Object.defineProperty(globalThis, "AudioContext", { configurable: true, value: AudioContext });
  t.after(() => delete globalThis.AudioContext);
  return contexts;
}
const L16 = "audio/L16; rate=24000; channels=1";
const int16 = (values) => new Uint8Array(new Int16Array(values).buffer);
function pcmStream(type = L16) {
  let stream;
  let cancelled = false;
  const response = new Response(
    new ReadableStream({
      start(controller) {
        stream = controller;
      },
      cancel() {
        cancelled = true;
      },
    }),
    { headers: { "Content-Type": type } },
  );
  return {
    response,
    send: (bytes) => stream.enqueue(bytes),
    close: () => stream.close(),
    cancelled: () => cancelled,
  };
}

test("audio/L16 replies stream into Web Audio as contiguous buffers, carrying an odd byte across chunks", async (t) => {
  const contexts = webAudio(t);
  const samples = [0, 1000, -1000, 32767, -32768, 12345, -1];
  const bytes = int16(samples);
  let audio;
  const env = setup(t, {
    speech: () => (audio = pcmStream()).response,
  });
  await env.controller.beginTalking();
  await env.controller.flush();
  await until(() => audio);
  // 3 + 4 + 1 + 6 bytes: three of the four splits land mid-sample.
  audio.send(bytes.slice(0, 3));
  await until(() => contexts[0]?.sources.length === 1);
  const context = contexts[0];
  assert.equal(env.controller.getSnapshot().speaking, true, "Bart speaks from the first buffer");
  for (const [from, to] of [[3, 7], [7, 8], [8, 14]]) audio.send(bytes.slice(from, to));
  audio.close();
  await until(() => context.sources.length === 4);
  const { sources } = context;
  assert.deepEqual(sources.map((s) => s.buffer.length), [1, 2, 1, 3]);
  assert.ok(sources.every((s) => s.buffer.sampleRate === 24_000 && s.destination === context.destination));
  assert.deepEqual(
    sources.flatMap((s) => [...s.buffer.getChannelData(0)]),
    samples.map((value) => value / 32768),
  );
  assert.equal(sources[0].when, 0.05, "a small lead before the first buffer");
  for (let i = 1; i < sources.length; i++)
    assert.equal(sources[i].when, sources[i - 1].when + sources[i - 1].buffer.length / 24_000, "back to back");
  assert.equal(env.audioElements.length, 0);
  assert.equal(env.objects.length, 0, "no MediaSource or Blob for PCM");
  for (const source of sources.slice(0, -1)) source.onended();
  assert.equal(env.controller.getSnapshot().speaking, true, "still speaking until the last buffer ends");
  assert.equal(context.closed, false);
  sources.at(-1).onended();
  assert.equal(env.controller.getSnapshot().speaking, false);
  assert.equal(context.closed, true);
  assert.equal(env.controller.getSnapshot().error, null);
});

test("audio/L16 honours the rate parameter case-insensitively and its own larger byte cap", async (t) => {
  const contexts = webAudio(t);
  const replies = [
    () => new Response(int16([1, 2, 3, 4]), { headers: { "Content-Type": "AUDIO/l16;rate=16000" } }),
    // Twice the MP3 cap still plays as PCM; one byte over the PCM cap does not.
    () => new Response(new Uint8Array(2 * 1024 * 1024), { headers: { "Content-Type": L16 } }),
    () => new Response(new Uint8Array(4 * 1024 * 1024 + 1), { headers: { "Content-Type": L16 } }),
  ];
  const env = setup(t, { speech: (_request, count) => replies[count - 1]() });
  await env.controller.beginTalking();
  await env.controller.flush();
  await until(() => contexts[0]?.sources.length === 1);
  assert.equal(contexts[0].sources[0].buffer.sampleRate, 16_000);
  contexts[0].sources[0].onended();
  assert.equal(contexts[0].closed, true);
  await env.controller.beginTalking();
  await env.controller.flush();
  await until(() => contexts[1]?.sources.length >= 1);
  assert.equal(contexts[1].sources.reduce((n, s) => n + s.buffer.length, 0), 1024 * 1024);
  await env.controller.beginTalking();
  assert.equal(contexts[1].closed, true, "talking over Bart closes his audio");
  await env.controller.flush();
  await until(() => /too large to play/.test(env.controller.getSnapshot().error ?? ""));
  assert.equal(contexts[2].closed, true);
  assert.ok(contexts[2].sources.every((s) => s.stopped));
  assert.equal(env.controller.getSnapshot().speaking, false);
});

test("audio/L16 playback blocked by autoplay resumes its AudioContext", async (t) => {
  const contexts = webAudio(t, { state: "suspended" });
  const env = setup(t, {
    speech: () => new Response(int16([5, 6, 7]), { headers: { "Content-Type": L16 } }),
  });
  await env.controller.beginTalking();
  await env.controller.flush();
  await until(() => env.controller.getSnapshot().playbackBlocked);
  assert.equal(env.controller.getSnapshot().speaking, false);
  const [context] = contexts;
  await env.controller.resumePlayback();
  assert.equal(context.state, "running");
  assert.equal(env.controller.getSnapshot().playbackBlocked, false);
  assert.equal(env.controller.getSnapshot().speaking, true);
  context.sources[0].onended();
  assert.equal(env.controller.getSnapshot().speaking, false);
  assert.equal(context.closed, true);
});

test("stop aborts the PCM request, cancels its reader, stops every scheduled buffer and closes the context", async (t) => {
  const contexts = webAudio(t);
  let audio;
  const env = setup(t, { speech: () => (audio = pcmStream()).response });
  await env.controller.beginTalking();
  await env.controller.flush();
  await until(() => audio);
  audio.send(int16([1, 2]));
  audio.send(int16([3, 4]));
  await until(() => contexts[0]?.sources.length === 2);
  assert.equal(env.controller.getSnapshot().speaking, true);
  await env.controller.stop();
  const [context] = contexts;
  assert.equal(env.speeches[0].signal.aborted, true);
  assert.equal(audio.cancelled(), true);
  assert.ok(context.sources.every((s) => s.stopped && s.onended === null));
  assert.equal(context.closed, true);
  assert.equal(context.onstatechange, null);
  assert.equal(env.controller.getSnapshot().speaking, false);
  assert.equal(env.controller.getSnapshot().error, null);
});

test("audio/mpeg replies never create an AudioContext", async (t) => {
  const contexts = webAudio(t);
  const env = setup(t);
  await env.controller.beginTalking();
  await env.controller.flush();
  await until(() => env.controller.getSnapshot().speaking);
  assert.equal(env.audioElements.length, 1);
  assert.equal(contexts.length, 0);
});

test("hold-Space-to-talk listens on the call screen but leaves Space to scroll the report", async (t) => {
  const env = setup(t);
  const listened = (props) => {
    const effects = [];
    chatInput(env, { props, effects });
    const listeners = [];
    const target = { addEventListener: (type) => listeners.push(type), removeEventListener() {} };
    globalThis.window = target;
    globalThis.document = target;
    try {
      // The Space-to-talk effect is the one that depends on beginTalking.
      for (const { effect, deps } of effects)
        if (deps?.includes(env.controller.beginTalking)) effect();
    } finally {
      delete globalThis.window;
      delete globalThis.document;
    }
    return listeners;
  };
  assert.ok(listened({}).includes("keydown"));
  assert.deepEqual(listened({ spaceToTalk: false }), []);
});

test("a voice turn that lands during a typed reply is never counted as that reply", async (t) => {
  const spoken = (role, content) => ({
    id: "voice-deepgram-turn-" + role,
    type: "text",
    role,
    content,
    metadata: { source: "live-voice", sessionId: "deepgram-turn" },
  });
  const typed = { id: "typed-user", type: "text", role: "user", content: "Typed fallback" };
  // The typed reply fails: Bart's spoken line must not be marked failed with it.
  const failed = setup(t);
  const failing = chatInput(failed, {
    send: () =>
      failed.history([
        spoken("user", "Can you commit to Friday?"),
        spoken("assistant", "Friday works."),
        typed,
        { id: "error", type: "text", role: "assistant", content: "An error occurred while sending your message." },
      ]),
  });
  await failing.submit();
  assert.ok(failing.errors().includes("No reply came back. Your draft is still here."));
  assert.match(buildReportTranscript(failed.getHistory()), /bart: Friday works\./);
  // The typed reply is empty: a voice line must not pass as the reply.
  const empty = setup(t);
  const silent = chatInput(empty, {
    send: () => empty.history([spoken("user", "Hello"), spoken("assistant", "Hi."), typed]),
  });
  await silent.submit();
  assert.ok(silent.errors().includes("No reply came back. Your draft is still here."));
  assert.equal(silent.cleared(), 0);
});
