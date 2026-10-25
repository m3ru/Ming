// Real frontend helper and page regressions, using synthetic responses only.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const require = createRequire(join(root, "package.json"));
function loader(overrides = {}) {
  const cache = new Map();
  return function load(relative) {
    const filename = resolve(root, relative);
    if (cache.has(filename)) return cache.get(filename).exports;
    const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    });
    const loaded = new Module(filename);
    loaded.filename = filename;
    loaded.paths = Module._nodeModulePaths(dirname(filename));
    cache.set(filename, loaded);
    loaded.require = (specifier) => {
      if (Object.hasOwn(overrides, specifier)) return overrides[specifier];
      if (specifier.startsWith("@/") || specifier.startsWith(".")) {
        const base = specifier.startsWith("@/")
          ? join(root, "src", specifier.slice(2))
          : resolve(dirname(filename), specifier);
        const target = [base, base + ".ts", base + ".tsx"].find((p) =>
          existsSync(p),
        );
        if (target) return load(target);
      }
      return require(specifier);
    };
    loaded._compile(compiled.outputText, filename);
    return loaded.exports;
  };
}
const load = loader();
const { followUpSource, readFollowUpCache, createFollowUpController } = load(
  "src/lib/followUp.ts",
);
const scenario = {
  title: "Synthetic follow-up",
  goal: "Agree on an action",
  goalForAnalyzer: "Evaluate a clear action",
  situation: "A synthetic follow-up meeting",
  situationForAnalyzer: "The manager follows up",
  companyDetails: "Ming values transparency",
  userRole: "Engineering manager",
  npcs: [
    {
      name: "Bart",
      role: "Engineer",
      pfp: "https://example.com/bart.jpg",
      personality: "Thoughtful and cooperative",
      scenarioSpecificInfo: "Needs a clear action",
    },
  ],
  documents: [
    {
      title: "Plan",
      type: "report",
      content: [{ format: "plain", content: "Confirm the next step" }],
    },
  ],
};
const source = (sessionId = "source-session", extra = {}) =>
  followUpSource(
    JSON.stringify({
      sessionId,
      summary: "## CONVERSATION OVERVIEW\nActual saved summary",
      analysis: "Actual saved analysis",
      ...extra,
    }),
  );
const response = (value = scenario) => ({
  ok: true,
  json: async () => ({ status: "success", result: { scenario: value } }),
});
function memory() {
  const data = new Map();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
  };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
function harness(fetcher, storage = memory(), timeoutMs = 1000) {
  const states = [];
  const controller = createFollowUpController({
    storage: () => storage,
    fetch: fetcher,
    onState: (state) => states.push(state),
    timeoutMs,
  });
  return { controller, storage, states, latest: () => states.at(-1) };
}

test("source uses the actual saved report and source session; missing metadata cannot generate", () => {
  const current = source();
  assert.equal(current.threadId, "source-session");
  assert.match(current.analysis, /Actual saved summary/);
  assert.match(current.analysis, /Actual saved analysis/);
  assert.equal(
    followUpSource(JSON.stringify({ summary: "saved summary" })),
    undefined,
  );
  assert.equal(
    followUpSource(JSON.stringify({ sessionId: "source-session" })),
    undefined,
  );
  assert.equal(
    followUpSource(
      JSON.stringify({
        sessionId: "source-session",
        summary: "x".repeat(96001),
      }),
    ),
    undefined,
  );
});

test("generation is explicit, locks rapid clicks, posts source analysis, and caches only validated success", async () => {
  const pending = deferred();
  const calls = [];
  const h = harness((...args) => {
    calls.push(args);
    return pending.promise;
  });
  const current = source();
  h.controller.setSource(current);
  assert.equal(calls.length, 0);
  const first = h.controller.generate();
  const duplicate = h.controller.generate();
  assert.equal(calls.length, 1);
  assert.equal(h.latest().status, "loading");
  const body = JSON.parse(calls[0][1].body);
  assert.equal(body.threadId, current.threadId);
  assert.equal(body.analysis, current.analysis);
  assert.equal(body.additionalContext.sourceReportId, current.reportId);
  pending.resolve(response());
  await Promise.all([first, duplicate]);
  assert.equal(h.latest().status, "ready");
  assert.deepEqual(readFollowUpCache(h.storage, current), scenario);
});

test("same report restores its preview; another report or reused report ID cannot borrow it", async () => {
  const h = harness(async () => response());
  const original = source("same-session", { reportId: "same-id" });
  h.controller.setSource(original);
  await h.controller.generate();
  const restored = harness(() => {
    throw new Error("Should not auto-generate");
  }, h.storage);
  restored.controller.setSource(original);
  assert.equal(restored.latest().status, "ready");
  for (const other of [
    source("other-session"),
    source("same-session", {
      reportId: "same-id",
      analysis: "A different report",
    }),
  ]) {
    restored.controller.setSource(other);
    assert.equal(restored.latest().status, "idle");
    assert.equal(readFollowUpCache(h.storage, other), undefined);
  }
  h.storage.data.set("ming.followUp.v1", "{");
  assert.equal(readFollowUpCache(h.storage, original), undefined);
});

test("malformed scenarios never reach preview/cache and a retry can succeed", async () => {
  let attempt = 0;
  const h = harness(async () =>
    response(++attempt === 1 ? { title: "Incomplete" } : scenario),
  );
  h.controller.setSource(source());
  await h.controller.generate();
  assert.equal(h.latest().status, "error");
  assert.match(h.latest().message, /incomplete/);
  assert.equal(h.storage.data.size, 0);
  await h.controller.generate();
  assert.equal(h.latest().status, "ready");
});

test("failed service and blocked storage leave a recoverable error without fake scenario", async () => {
  for (const fetcher of [
    async () => ({ ok: false }),
    async () => {
      throw new Error("Offline");
    },
  ]) {
    const h = harness(fetcher);
    h.controller.setSource(source());
    await h.controller.generate();
    assert.equal(h.latest().status, "error");
    assert.equal(h.storage.data.size, 0);
  }
  const h = harness(async () => response(), {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("quota");
    },
  });
  h.controller.setSource(source());
  assert.match(h.latest().message, /storage/);
  await h.controller.generate();
  assert.equal(h.latest().status, "error");
  assert.match(h.latest().message, /could not be saved/);
});

test("cancel aborts the request, unlocks retry, and ignores a late response from the cancelled request", async () => {
  const pending = deferred();
  let signal;
  let attempts = 0;
  const h = harness((_url, options) => {
    attempts++;
    signal = options.signal;
    return attempts === 1
      ? pending.promise
      : Promise.resolve(response({ ...scenario, title: "Retried follow-up" }));
  });
  h.controller.setSource(source());
  const first = h.controller.generate();
  const firstSignal = signal;
  h.controller.cancel();
  assert.equal(firstSignal.aborted, true);
  assert.equal(h.latest().status, "idle");
  await h.controller.generate();
  assert.equal(h.latest().scenario.title, "Retried follow-up");
  pending.resolve(response({ ...scenario, title: "Stale follow-up" }));
  await first;
  assert.equal(h.latest().scenario.title, "Retried follow-up");
  assert.equal(
    readFollowUpCache(h.storage, source()).title,
    "Retried follow-up",
  );
});

test("switching source during generation ignores both stale success and stale failure", async () => {
  for (const failed of [false, true]) {
    const pending = deferred();
    const h = harness(() => pending.promise);
    const firstSource = source("first");
    const nextSource = source("next");
    h.controller.setSource(firstSource);
    const task = h.controller.generate();
    h.controller.setSource(nextSource);
    if (failed) pending.reject(new Error("Late failure"));
    else pending.resolve(response());
    await task;
    assert.equal(h.latest().status, "idle");
    assert.equal(h.storage.data.size, 0);
  }
});

test("a bounded timeout aborts and provides retry instead of leaving generation stuck", async () => {
  const h = harness(
    (_url, { signal }) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        }),
      ),
    memory(),
    5,
  );
  h.controller.setSource(source());
  await h.controller.generate();
  assert.equal(h.latest().status, "error");
  assert.match(h.latest().message, /too long/);
});

function renderScenario(loaded) {
  const effects = [];
  const updates = [];
  const mounted = [];
  const states = [loaded, undefined];
  const child = (kind) =>
    function ScenarioChild({ scenario }) {
      mounted.push({ kind, scenario });
      return React.createElement("div", null, scenario.title);
    };
  const pageLoad = loader({
    react: {
      ...React,
      useState: () => [states.shift(), (value) => updates.push(value)],
      useEffect: (effect) => effects.push(effect),
    },
    "@/lib/practiceSession": { readActiveScenario: () => scenario },
    "@/components/ScenarioOverview": child("overview"),
    "@/components/ScenarioVideo": child("video"),
    "@/cedar/components/chatComponents/SidePanelCedarChat": {
      SidePanelCedarChat: child("chat"),
    },
    "@/components/SentimentBar": () => null,
    "@/hooks/useOrientation": () => "landscape",
    "next/link": ({ href, children }) =>
      React.createElement("a", { href }, children),
  });
  const markup = renderToStaticMarkup(
    React.createElement(pageLoad("src/app/scenario/page.tsx").default),
  );
  return { markup, mounted, effects, updates };
}
test("scenario resolves saved context before mounting video/chat; invalid storage renders safe recovery", () => {
  const loading = renderScenario(undefined);
  assert.match(loading.markup, /Loading your scenario/);
  assert.equal(loading.mounted.length, 0);
  loading.effects[0]();
  assert.equal(loading.updates[0].scenario, scenario);
  const ready = renderScenario({ scenario });
  assert.equal(ready.mounted.length, 3);
  assert.ok(ready.mounted.every((m) => m.scenario === scenario));
  const invalid = renderScenario({ error: "Storage invalid" });
  assert.match(invalid.markup, /Scenario unavailable/);
  assert.match(invalid.markup, /Return home/);
  assert.equal(invalid.mounted.length, 0);
  const sourceCode = readFileSync(
    join(root, "src/app/scenario/page.tsx"),
    "utf8",
  );
  assert.doesNotMatch(
    sourceCode,
    /visibilitychange|scenarioCompleted|scenario-next|\?next=true/,
  );
});

test("a response that ignores abort cannot cache or preview success after timeout", async () => {
  const pending = deferred();
  const aborted = deferred();
  const h = harness(
    (_url, { signal }) => {
      signal.addEventListener("abort", () => aborted.resolve(), { once: true });
      return pending.promise;
    },
    memory(),
    5,
  );
  h.controller.setSource(source());
  const task = h.controller.generate();
  await aborted.promise;
  pending.resolve(response());
  await task;
  assert.equal(h.latest().status, "error");
  assert.match(h.latest().message, /too long/);
  assert.equal(h.storage.data.size, 0);
});
