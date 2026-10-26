import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// Run VoiceSessionProvider's real transcript callback and store subscription against a
// Cedar-like store, without a browser or React renderer.
function loadProvider(store) {
  let dependencies;
  class Controller {
    constructor(options) {
      dependencies = options;
    }
    stop = () => Promise.resolve();
    syncContext() {}
    syncTypedMessages() {}
    dispose() {}
  }
  const react = {
    createContext: () => ({ Provider: "Provider" }),
    useContext: () => null,
    useSyncExternalStore: () => ({}),
    useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
    useEffect: (effect) => effect(),
  };
  const mocks = {
    react,
    "react/jsx-runtime": { jsx: () => null },
    "next/navigation": { usePathname: () => "/scenario" },
    "cedar-os": { useCedarStore: store },
    "@/lib/liveVoice": { LiveVoiceController: Controller },
    "@/lib/deepgramVoice": { DeepgramVoiceController: Controller },
    "@/lib/chatErrors": { isChatErrorMessage: () => false },
  };
  const { outputText } = ts.transpileModule(
    readFileSync(new URL("../src/hooks/useVoiceSession.tsx", import.meta.url), "utf8"),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  );
  const loaded = { exports: {} };
  new Function("require", "module", "exports", "window", "localStorage", outputText)(
    (id) => {
      assert.ok(Object.hasOwn(mocks, id), "unexpected useVoiceSession import: " + id);
      return mocks[id];
    },
    loaded,
    loaded.exports,
    { addEventListener() {}, removeEventListener() {} },
    { setItem() {} },
  );
  loaded.exports.VoiceSessionProvider({ children: null, provider: "deepgram" });
  return dependencies;
}

function cedarStore(messages) {
  let state = { isProcessing: false, mainThreadId: "thread", additionalContext: {}, messages };
  const listeners = new Set();
  const set = (patch) => {
    const previous = state;
    state = { ...state, ...patch };
    for (const listener of listeners) listener(state, previous);
  };
  const api = {
    getThreadMessages: () => state.messages,
    setMessages: (next) => set({ messages: next }),
  };
  const store = () => {
    throw new Error("selector hooks are not used by the provider");
  };
  store.getState = () => ({ ...state, ...api });
  store.subscribe = (listener) => (listeners.add(listener), () => listeners.delete(listener));
  return {
    store,
    set,
    messages: () => state.messages,
    // Cedar's appendToLatestMessage: a streamed chunk joins the last non-user text message.
    appendChunk(content) {
      const last = state.messages.at(-1);
      if (last && last.role !== "user" && last.type === "text")
        set({ messages: [...state.messages.slice(0, -1), { ...last, content: last.content + content }] });
      else set({ messages: [...state.messages, { id: "new", role: "assistant", type: "text", content }] });
    },
  };
}

const at = (seconds) => new Date(Date.UTC(2026, 9, 25, 12, 0, seconds)).toISOString();
const voice = (role, content, seconds) => ({
  id: "voice-deepgram-turn-" + role,
  role,
  content,
  createdAt: at(seconds),
  metadata: { source: "live-voice", sessionId: "deepgram-turn" },
});

test("a voice transcript during a streaming typed reply keeps the reply whole and the store current", () => {
  const cedar = cedarStore([
    { id: "typed", role: "user", type: "text", content: "Can we talk?", createdAt: at(0) },
    { id: "reply", role: "assistant", type: "text", content: "Sure,", createdAt: at(1) },
  ]);
  const { transcript, messages } = loadProvider(cedar.store);
  cedar.set({ isProcessing: true });

  transcript("thread", "deepgram-turn", [voice("user", "About the deadline", 2)]);
  transcript("thread", "deepgram-turn", [
    voice("user", "About the deadline", 2),
    voice("assistant", "I know.", 3),
  ]);
  // Saves and the next voice turn read the store, so the voice lines must be there now.
  assert.deepEqual(
    messages("thread").map((m) => m.content),
    ["Can we talk?", "About the deadline", "I know.", "Sure,"],
  );
  // The rest of the typed reply still streams into Bart's typed message.
  cedar.appendChunk(" let's talk.");
  assert.equal(cedar.messages().at(-1).content, "Sure, let's talk.");

  cedar.set({ isProcessing: false });
  assert.deepEqual(
    cedar.messages().map((m) => [m.role, m.content]),
    [
      ["user", "Can we talk?"],
      ["assistant", "Sure, let's talk."],
      ["user", "About the deadline"],
      ["assistant", "I know."],
    ],
  );
});

test("a voice transcript outside a typed reply shows at once", () => {
  const cedar = cedarStore([]);
  const { transcript } = loadProvider(cedar.store);
  transcript("thread", "deepgram-turn", [voice("user", "Hello Bart", 0)]);
  assert.deepEqual(cedar.messages().map((m) => m.content), ["Hello Bart"]);
});
