import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { loadBackendSource } from "./backend-runtime.mjs";

// Exercise the real classifier without loading Cedar or any network provider.
const { outputText } = ts.transpileModule(
  readFileSync(new URL("../src/lib/chatErrors.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.ES2022 } },
);
const { isChatErrorMessage, markFailedChatMessages } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);

const observerSource = ts.transpileModule(
  readFileSync(
    new URL("../src/lib/chatStreamObserver.ts", import.meta.url),
    "utf8",
  ),
  { compilerOptions: { module: ts.ModuleKind.ES2022 } },
).outputText;
const { observeNextChatStream } = await import(
  `data:text/javascript;base64,${Buffer.from(observerSource).toString("base64")}`
);

test("structured stream failures are interface errors regardless of content", () => {
  assert.equal(
    isChatErrorMessage({
      type: "error",
      role: "bot",
      message: "The AI service is unavailable.",
    }),
    true,
  );
  assert.equal(isChatErrorMessage({ type: "error" }), true);
});

test("Cedar's swallowed HTTP and transport errors are recognized", () => {
  for (const role of ["assistant", "bot"]) {
    assert.equal(
      isChatErrorMessage({
        type: "text",
        role,
        content: "An error occurred while sending your message.",
      }),
      true,
    );
  }
});

test("a user quoting the failure text remains user content", () => {
  assert.equal(
    isChatErrorMessage({
      type: "text",
      role: "user",
      content: "An error occurred while sending your message.",
    }),
    false,
  );
});

test("ordinary dialogue, hidden tools, and empty messages remain unchanged", () => {
  for (const message of [
    {
      type: "text",
      role: "assistant",
      content: "I made an error in the report.",
    },
    { type: "text", role: "user", content: "Could we discuss this?" },
    { type: "tool-result", message: "tool failed" },
    { type: "text", role: "assistant", content: "" },
    {},
  ]) {
    assert.equal(isChatErrorMessage(message), false);
  }
});

test("swallowed Cedar transport errors are observed without changing event handling", async () => {
  const delivered = [];
  const error = { type: "error", error: new Error("Synthetic HTTP 503") };
  const original = (_params, handler) => ({
    completion: Promise.resolve().then(() => handler(error)),
    abort() {},
  });
  let state = { streamLLM: original };
  const observer = observeNextChatStream(
    () => state,
    (patch) => {
      state = { ...state, ...patch };
    },
  );
  const response = state.streamLLM({}, (event) => delivered.push(event));
  // The wrapper has already left the store before an asynchronous error arrives.
  assert.equal(state.streamLLM, original);
  assert.equal(observer.hasFailed(), false);
  await response.completion;
  assert.equal(observer.hasFailed(), true);
  assert.deepEqual(delivered, [error]);
});

test("observer cleanup preserves later method replacement and healthy streams", async () => {
  const original = (_params, handler) => ({
    completion: Promise.resolve().then(() =>
      handler({ type: "chunk", content: "Healthy reply" }),
    ),
    abort() {},
  });
  let state = { streamLLM: original };
  const setState = (patch) => {
    state = { ...state, ...patch };
  };
  const observer = observeNextChatStream(() => state, setState);
  await state.streamLLM({}, () => {}).completion;
  assert.equal(observer.hasFailed(), false);
  const later = () => {};
  state.streamLLM = later;
  observer.restore();
  assert.equal(state.streamLLM, later);

  const unusedObserver = observeNextChatStream(() => state, setState);
  unusedObserver.restore();
  assert.equal(state.streamLLM, later);
});

test("structured SSE failures are observed even before Cedar stores them", async () => {
  for (const object of [{ type: "error" }, [{ type: "error" }]]) {
    let state = {
      streamLLM: (_params, handler) => ({
        completion: Promise.resolve().then(() =>
          handler({ type: "object", object }),
        ),
        abort() {},
      }),
    };
    const observer = observeNextChatStream(
      () => state,
      (patch) => {
        state = { ...state, ...patch };
      },
    );
    await state.streamLLM({}, () => {}).completion;
    assert.equal(observer.hasFailed(), true);
  }
});

test("stream completion waits for Cedar's asynchronous message handlers", async () => {
  let finishHandler;
  let state = {
    streamLLM: (_params, handler) => {
      handler({ type: "object", object: { type: "error" } });
      return { completion: Promise.resolve(), abort() {} };
    },
  };
  observeNextChatStream(
    () => state,
    (patch) => {
      state = { ...state, ...patch };
    },
  );
  const response = state.streamLLM(
    {},
    () =>
      new Promise((resolve) => {
        finishHandler = resolve;
      }),
  );
  let completed = false;
  response.completion.then(() => {
    completed = true;
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(completed, false);
  finishHandler();
  await response.completion;
  assert.equal(completed, true);
});

test("real installed Cedar retains a partial reply but excludes failed generation from reports", async () => {
  const { useCedarStore } = createRequire(import.meta.url)("cedar-os");
  const previousState = useCedarStore.getState();
  const previousFetch = globalThis.fetch;
  const previousElement = globalThis.Element;
  globalThis.Element ??= class Element {};
  const { buildReportTranscript } = loadBackendSource(
    "src/lib/reportTranscript.ts",
    {
      "./chatErrors": { isChatErrorMessage },
    },
  );
  try {
    const state = useCedarStore.getState();
    state.setProviderConfig({
      provider: "mastra",
      baseURL: "http://synthetic.invalid",
      chatPath: "/chat",
    });
    const threadId = state.createThread("Synthetic partial-failure regression");
    state.setMainThreadId(threadId);
    state.setChatInputContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Please discuss deadlines" }],
        },
      ],
    });
    const previousIds = new Set(
      state.getThreadMessages(threadId).map((message) => message.id),
    );
    globalThis.fetch = async (url) => {
      assert.equal(url, "http://synthetic.invalid/chat/stream");
      return new Response(
        "data:Partial reply\n\ndata: " +
          JSON.stringify({
            type: "error",
            code: "PROVIDER_UNAVAILABLE",
            message: "Synthetic failure",
            retryable: true,
          }) +
          "\n\n",
        { headers: { "Content-Type": "text/event-stream" } },
      );
    };
    const observer = observeNextChatStream(useCedarStore.getState, (patch) =>
      useCedarStore.setState(patch),
    );
    await state.sendMessage({ stream: true, userId: "synthetic-user" });
    assert.equal(observer.hasFailed(), true);
    // No next-tick wait: observer completion must settle structured insertion.
    assert.ok(
      useCedarStore
        .getState()
        .getThreadMessages(threadId)
        .some(isChatErrorMessage),
    );
    markFailedChatMessages(useCedarStore.getState(), threadId, previousIds);
    const messages = useCedarStore.getState().getThreadMessages(threadId);
    const partial = messages.find(
      (message) => message.content === "Partial reply",
    );
    assert.ok(partial);
    assert.equal(partial.metadata.generationFailed, true);
    assert.equal(
      messages.find((message) => message.role === "user").content,
      "Please discuss deadlines",
    );
    assert.equal(buildReportTranscript(messages), null);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousElement === undefined) delete globalThis.Element;
    else globalThis.Element = previousElement;
    useCedarStore.setState(previousState, true);
  }
});

test("a send error after Bart's partial reply renders as an error, not as his words", () => {
  const { outputText } = ts.transpileModule(
    readFileSync(new URL("../src/lib/groupConversationMessages.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  );
  const loaded = { exports: {} };
  new Function("require", "module", "exports", outputText)(
    (id) => {
      assert.equal(id, "./chatErrors");
      return { isChatErrorMessage };
    },
    loaded,
    loaded.exports,
  );
  const { groupConversationMessages } = loaded.exports;
  const text = (id, role, content) => ({ id, role, type: "text", content });
  const grouped = groupConversationMessages([
    text("u", "user", "Hello"),
    text("b1", "assistant", "I was about to"),
    text("e", "assistant", "An error occurred while sending your message."),
    text("b2", "assistant", "Sorry, as I said"),
    text("b3", "assistant", "the deadline slipped."),
  ]);
  assert.deepEqual(
    grouped.map((message) => [message.id, isChatErrorMessage(message)]),
    [["u", false], ["b1", false], ["e", true], ["b2", false]],
  );
  // Ordinary consecutive lines from Bart still share one bubble.
  assert.equal(grouped.at(-1).content, "Sorry, as I said\n\nthe deadline slipped.");
});
