import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { loadBackendSource } from "./backend-runtime.mjs";

const schema = loadBackendSource("src/lib/scenarioSchema.ts", {
  "../backend/src/lib/scenarioSchema": loadBackendSource("src/backend/src/lib/scenarioSchema.ts"),
});
const session = loadBackendSource("src/lib/practiceSession.ts", {
  "./scenarioSchema": schema,
});
const { createSessionStarter, readActiveScenario } = session;
const scenario = {
  title: "Clarify competing priorities",
  goal: "Agree on priorities and next steps.",
  goalForAnalyzer: "Agree on priorities and next steps.",
  situation: "A teammate needs help with competing deadlines.",
  situationForAnalyzer: "A teammate needs help with competing deadlines.",
  companyDetails: "A small software team.",
  userRole: "Engineering team lead",
  npcs: [{ name: "Jordan", role: "Teammate", pfp: "https://example.com/portrait.jpg", personality: "Direct but worried", scenarioSpecificInfo: "Two deadlines conflict." }],
  documents: [{ title: "Priorities", type: "email", content: [{ format: "plain", content: "Two projects need a decision." }] }],
};

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup(options = {}) {
  const store = storage(options.initial);
  const events = [];
  const states = [];
  const errors = [];
  let processing = false;
  const start = createSessionStarter({
    isProcessing: () => processing,
    stopVoice: async () => { events.push("stop"); await options.stop?.(); events.push("saved"); },
    storage: () => options.storage?.() ?? store,
    navigate: (path) => events.push(["navigate", path]),
    onStarting: (value) => states.push(value),
    onError: (value) => errors.push(value),
  });
  return { start, store, events, states, errors, processing: (value) => { processing = value; } };
}

test("New Session waits for pending voice work before changing storage or navigating", async () => {
  const save = deferred();
  const env = setup({ stop: () => save.promise, initial: { activeScenario: "old" } });
  const operation = env.start(scenario);
  await Promise.resolve();
  assert.deepEqual(env.events, ["stop"]);
  assert.equal(env.store.getItem("activeScenario"), "old");
  save.resolve();
  await operation;
  assert.deepEqual(env.events, ["stop", "saved", ["navigate", "/scenario"]]);
  assert.deepEqual(readActiveScenario(env.store), scenario);
});

test("rapid clicks share one handoff even after navigation was assigned", async () => {
  const save = deferred();
  const env = setup({ stop: () => save.promise });
  const first = env.start(scenario);
  assert.equal(env.start(), first);
  save.resolve();
  await first;
  assert.equal(env.start(), first);
  assert.deepEqual(env.states, [true]);
  assert.equal(env.events.filter((item) => item === "stop").length, 1);
  assert.equal(env.events.filter(Array.isArray).length, 1);
});

test("a failed voice save leaves the recording owner and active scenario intact and allows retry", async () => {
  let fail = true;
  const env = setup({ stop: async () => { if (fail) throw Error("Transcript save unavailable."); }, initial: { activeScenario: "old" } });
  await assert.rejects(env.start(scenario), /Transcript save unavailable.*Continue by text/);
  assert.deepEqual(env.events, ["stop"]);
  assert.equal(env.store.getItem("activeScenario"), "old");
  assert.deepEqual(env.states, [true, false]);
  assert.match(env.errors.at(-1), /current session is still open/);
  fail = false;
  await env.start(scenario);
  assert.deepEqual(readActiveScenario(env.store), scenario);
  assert.equal(env.events.filter(Array.isArray).length, 1);
});

test("in-flight Cedar replies reject New Session before stopping voice", async () => {
  const env = setup();
  env.processing(true);
  await assert.rejects(env.start(), /current reply/);
  assert.deepEqual(env.events, []);
  assert.deepEqual(env.states, [true, false]);
});

test("a Cedar reply started during voice finalization also prevents the handoff", async () => {
  const save = deferred();
  const env = setup({ stop: () => save.promise });
  const operation = env.start();
  await Promise.resolve();
  env.processing(true);
  save.resolve();
  await assert.rejects(operation, /current reply/);
  assert.deepEqual(env.events, ["stop", "saved"]);
});

test("generated scenario survives a fresh page read and default New Session resets only its selection", async () => {
  const saved = { reportData: "saved report", completedScenarios: '["session-1"]', numScenariosCompleted: "1" };
  const env = setup({ initial: saved });
  await env.start(scenario);
  const reloaded = storage(Object.fromEntries(env.store.values));
  assert.deepEqual(readActiveScenario(reloaded), scenario);
  const reset = setup({ initial: Object.fromEntries(reloaded.values) });
  await reset.start();
  assert.equal(readActiveScenario(reset.store), undefined);
  assert.deepEqual(Object.fromEntries(reset.store.values), saved);
});

test("unavailable, full or unwritable session storage keeps the page open with a recovery message", async () => {
  for (const failure of [
    () => { throw Error("SecurityError"); },
    () => ({ setItem() { throw Error("QuotaExceededError"); }, removeItem() { throw Error("SecurityError"); } }),
  ]) {
    for (const selection of [scenario, undefined]) {
      const env = setup({ storage: failure });
      await assert.rejects(env.start(selection), /browser storage/);
      assert.deepEqual(env.events, ["stop", "saved"]);
      assert.deepEqual(env.states, [true, false]);
      assert.match(env.errors.at(-1), /retry New session/);
    }
  }
});

test("malformed active scenarios fail explicitly rather than starting Bart silently", () => {
  for (const raw of ["", "{broken", "null", "{}", JSON.stringify({ ...scenario, npcs: [] })]) {
    assert.throws(() => readActiveScenario(storage({ activeScenario: raw })), /selected scenario could not be loaded/);
  }
  assert.throws(() => readActiveScenario({ getItem() { throw Error("denied"); } }), /Browser storage is unavailable/);
});

test("invalid generated selections cannot stop voice or replace the current selection", async () => {
  const env = setup({ initial: { activeScenario: "old" } });
  await assert.rejects(env.start({ ...scenario, npcs: [] }), /could not be started/);
  assert.deepEqual(env.events, []);
  assert.equal(env.store.getItem("activeScenario"), "old");
});

const require = createRequire(import.meta.url);
function component(path, mocks) {
  const output = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", output)((id) => {
    if (Object.hasOwn(mocks, id)) return mocks[id];
    if (id === "react/jsx-runtime") return require(id);
    throw Error("Unexpected component import: " + id);
  }, loaded, loaded.exports);
  return loaded.exports;
}

test("the mounted provider performs a full document assignment after voice stop", async (t) => {
  const save = deferred();
  const events = [];
  const store = storage();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { sessionStorage: store, location: { assign: (path) => events.push(path) } } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, "window", previous); else delete globalThis.window; });
  const react = {
    createContext: () => ({ Provider: "session-context" }),
    useContext() {},
    useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
  };
  const { SessionActionsProvider } = component("../src/components/SessionActionsProvider.tsx", {
    react,
    "cedar-os": { useCedarStore: { getState: () => ({ isProcessing: false }) } },
    "@/hooks/useVoiceSession": { useVoiceSession: () => ({ stop: () => save.promise }) },
    "@/lib/practiceSession": session,
  });
  const actions = SessionActionsProvider({ children: null }).props.value;
  const operation = actions.startNewSession(scenario);
  await Promise.resolve();
  assert.deepEqual(events, []);
  save.resolve();
  await operation;
  assert.deepEqual(events, ["/scenario"]);
  assert.deepEqual(readActiveScenario(store), scenario);
});

test("each document mount creates a new Cedar conversation UUID and retains provider nesting", () => {
  const Cedar = () => null;
  const Voice = () => null;
  const Actions = () => null;
  const AppProviders = component("../src/components/AppProviders.tsx", {
    react: { useState: (initial) => [initial()] },
    "cedar-os": { CedarCopilot: Cedar },
    "@/cedar/messageRenderers": { messageRenderers: {} },
    "@/components/MenuBar": { default: () => null, __esModule: true },
    "@/hooks/useVoiceSession": { VoiceSessionProvider: Voice },
    "@/components/SessionActionsProvider": { SessionActionsProvider: Actions },
  }).default;
  const first = AppProviders({ children: "practice", voiceProvider: "deepgram" });
  const second = AppProviders({ children: "practice", voiceProvider: "deepgram" });
  assert.equal(first.type, Cedar);
  assert.notEqual(first.props.threadId, second.props.threadId);
  assert.match(first.props.threadId, /^[a-f0-9-]{36}$/);
  assert.equal(first.props.children.type, Voice);
  assert.equal(first.props.children.props.children.type, Actions);
  assert.equal(first.props.children.props.children.props.children[1], "practice");
});

test("real voice recording stays recoverable after a failed New Session save until explicit text recovery", async (t) => {
  const { DeepgramVoiceController } = loadBackendSource("src/lib/deepgramVoice.ts");
  const recordings = [];
  class Recorder {
    static isTypeSupported() { return true; }
    state = "inactive";
    mimeType = "audio/webm";
    constructor() { recordings.push(this); }
    start() { this.state = "recording"; }
    stop() { this.state = "inactive"; }
    finish() {
      this.ondataavailable?.({ data: new Blob(["last recorded words"], { type: this.mimeType }) });
      this.onstop?.();
    }
  }
  const track = { enabled: false, stop() {} };
  for (const [key, value] of Object.entries({
    navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }) } },
    MediaRecorder: Recorder,
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => { if (previous) Object.defineProperty(globalThis, key, previous); else delete globalThis[key]; });
  }
  const response = deferred();
  const requests = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => { requests.push(JSON.parse(init.body)); return response.promise; });
  const transcripts = [];
  const voice = new DeepgramVoiceController({
    baseURL: () => "/api/backend",
    scope: () => ({ threadId: "current-practice", resourceId: "localhost-demo", context: {}, messages: [] }),
    messages: () => [],
    transcript: (...args) => transcripts.push(args),
  });
  t.after(() => voice.dispose());
  await voice.beginTalking();
  const recorder = recordings[0];
  assert.equal(recorder.state, "recording");
  const env = setup({ stop: voice.stop, initial: { activeScenario: "old selection" } });
  const operation = env.start(scenario);
  const rejection = assert.rejects(operation, /Could not save your transcript/);
  await new Promise(setImmediate);
  assert.equal(requests.length, 0, "navigation waits for the recorder's final chunk");
  assert.equal(env.events.filter(Array.isArray).length, 0);
  recorder.finish();
  await new Promise(setImmediate);
  assert.equal(requests.length, 1);
  assert.equal(Buffer.from(requests[0].audioBase64, "base64").toString(), "last recorded words");
  assert.equal(env.events.filter(Array.isArray).length, 0, "navigation also waits for persistence");
  response.resolve(Response.json({ status: "partial", persisted: false, sessionId: "deepgram-" + requests[0].turnId, messages: [], error: "Could not save your transcript." }));
  await rejection;
  assert.deepEqual(transcripts, []);
  assert.equal(env.store.getItem("activeScenario"), "old selection");
  assert.equal(env.events.filter(Array.isArray).length, 0);
  assert.equal(voice.canContinueByText(), true, "New Session must not discard the failed clip");
  await voice.continueByText();
  await env.start();
  assert.equal(requests.length, 1, "only the explicit text recovery releases the failed clip");
  assert.equal(env.events.filter(Array.isArray).length, 1);
  assert.equal(readActiveScenario(env.store), undefined);
});
