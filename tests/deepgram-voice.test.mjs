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
const errors = loadBackendSource("src/lib/chatErrors.ts");
const { buildReportTranscript } = loadBackendSource(
  "src/lib/reportTranscript.ts",
  {
    "./chatErrors": errors,
  },
);
// Run the actual input's submit/recovery handlers with the real voice controller.
// Only React rendering, editor APIs, and the typed transport are stand-ins.
function chatInput(env) {
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
    async sendMessage() {
      sent++;
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
    useEffect() {},
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
  const tree = loaded.exports.ChatInput({ stream: false });
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
function success(body, extra = {}) {
  const sessionId = "deepgram-" + body.turnId;
  return Response.json({
    status: "success",
    persisted: true,
    sessionId,
    messages: [
      {
        id: "voice-" + sessionId + "-user",
        role: "user",
        content: "Actual recognized words",
        createdAt: "2026-10-25T10:00:00.000Z",
      },
      {
        id: "voice-" + sessionId + "-assistant",
        role: "assistant",
        content: "Saved response",
        createdAt: "2026-10-25T10:00:01.000Z",
      },
    ],
    ...extra,
  });
}
function setup(t, options = {}) {
  const tracks = [];
  const recordings = [];
  const audioElements = [];
  const requests = [];
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
  t.mock.method(
    URL,
    "createObjectURL",
    () => "blob:test-" + audioElements.length,
  );
  t.mock.method(URL, "revokeObjectURL", (url) => revoked.push(url));
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const body = JSON.parse(init.body);
    const request = { url: String(url), body, signal: init.signal };
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
    transcripts,
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
  assert.equal(env.transcripts.length, 1);
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
  assert.equal(env.transcripts.length, 2);
  assert.notEqual(env.transcripts[0].sessionId, env.transcripts[1].sessionId);
  assert.equal(env.getHistory().length, 5);
  assert.ok(
    env.transcripts.every(({ messages }) =>
      messages.every((item) => item.metadata.source === "live-voice"),
    ),
  );
});

test("a partial generation/TTS failure keeps recognized text and does not block report finalization", async (t) => {
  const env = setup(t, {
    request: ({ body }) => {
      const response = success(body);
      return response.json().then((result) =>
        Response.json({
          ...result,
          status: "partial",
          messages: result.messages.slice(0, 1),
          error: "The AI could not respond. Your words are saved.",
        }),
      );
    },
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
});

test("failed transcript persistence rejects completion, then retries the exact request and ID", async (t) => {
  const env = setup(t, {
    request: ({ body }, count) =>
      count === 1
        ? Response.json({
            status: "partial",
            persisted: false,
            sessionId: "deepgram-" + body.turnId,
            messages: [],
            error: "Could not save your transcript.",
          })
        : success(body),
  });
  await env.controller.beginTalking();
  await assert.rejects(env.controller.stop(), /Could not save/);
  assert.equal(env.transcripts.length, 0);
  await env.controller.stop();
  assert.equal(env.requests.length, 2);
  assert.deepEqual(env.requests[0].body, env.requests[1].body);
  assert.equal(env.transcripts.length, 1);
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
  assert.equal(env.transcripts.length, 1);
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
    env.transcripts.length,
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
  assert.equal(env.transcripts.length, 1);
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
  assert.equal(env.transcripts.length, 1);
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
  assert.equal(env.transcripts.length, 1);
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
  assert.equal(env.transcripts.length, 1);
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
  response.resolve(
    success(env.requests[0].body, {
      audioBase64: "YXVkaW8=",
      audioMimeType: "audio/mpeg",
    }),
  );
  await tick();
  assert.equal(env.transcripts.length, 0);
  assert.equal(env.audioElements.length, 0);
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
  response.resolve(
    success(env.requests[0].body, {
      audioBase64: "YXVkaW8=",
      audioMimeType: "audio/mpeg",
    }),
  );
  await stop;
  assert.equal(env.transcripts[0].threadId, "thread-1");
  assert.equal(env.audioElements.length, 0);
  assert.equal(env.requests[0].body.threadId, "thread-1");
});

test("blocked audio can resume; speaking reflects playback and object URLs are revoked", async (t) => {
  const env = setup(t, {
    blockPlayback: true,
    request: ({ body }) =>
      success(body, { audioBase64: "YXVkaW8=", audioMimeType: "audio/mpeg" }),
  });
  await env.controller.beginTalking();
  await env.controller.flush();
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
