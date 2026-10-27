import assert from "node:assert/strict";
import { test } from "node:test";
import { loadBackendSource, loadReportWorkflow, loadReportService } from "./backend-runtime.mjs";

const locations = loadBackendSource("src/backend/src/lib/reportAnnotations.ts");
const { createReportCache, reportCacheKey } = loadBackendSource("src/backend/src/lib/reportCache.ts");
const clientLocations = loadBackendSource("src/lib/reportAnnotations.ts");
const { completeReportAnnotations } = loadBackendSource("src/lib/completeReportAnnotations.ts", { "./reportAnnotations": clientLocations });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const turn = () => new Promise((resolve) => setImmediate(resolve));
const transcript = "user: Hello Hello\nbart: Hi\nuser: Can we agree a deadline?";
const plan = { segments: [
  { title: "Opening", startLine: 0, highlights: [{ line: 0, quote: "Hello", occurrence: 1, color: "green", feedback: "Acknowledge the concern first." }] },
  { title: "Agreement", startLine: 2, highlights: [] },
] };

test("annotation locations preserve all source text, repeated quotes, and reject invented or overlapping spans", () => {
  const result = locations.buildAnnotationSegments(transcript, plan);
  assert.equal(result.map((s) => s.content).join("\n"), transcript);
  assert.equal(result[0].highlights[0].start, 12);
  assert.deepEqual(clientLocations.parseAnnotationSegments(result, transcript), result);
  const invalidPlans = [
    { segments: [{ ...plan.segments[0], startLine: 1 }] },
    { segments: [{ ...plan.segments[0], startLine: 90 }] },
    { segments: [plan.segments[0], { ...plan.segments[1], startLine: 0 }] },
    { segments: [{ ...plan.segments[0], highlights: [plan.segments[0].highlights[0], plan.segments[0].highlights[0]] }] },
  ];
  for (const invalid of invalidPlans) assert.throws(() => locations.buildAnnotationSegments(transcript, invalid));
  for (const change of [
    { quote: "invented" }, { line: 1, quote: "Hi", occurrence: 0 },
    { occurrence: 4 }, { quote: "user:", occurrence: 0 },
  ]) {
    let rejected = 0;
    const clean = locations.buildAnnotationSegments(transcript, { segments: [{ ...plan.segments[0], highlights: [{ ...plan.segments[0].highlights[0], ...change }] }] }, () => rejected++);
    assert.equal(clean[0].highlights.length, 0);
    assert.equal(clean[0].content, transcript);
    assert.equal(rejected, 1);
  }
  assert.equal(clientLocations.parseAnnotationSegments(result, "different source"), undefined);
  assert.equal(clientLocations.parseAnnotationSegments([{ ...result[0], highlights: [{ start: -1, end: 1, color: "red", feedback: "bad" }] }], result[0].content), undefined);
});

test("stage cache coalesces in-flight work, expires successes and retries failures within capacity", async () => {
  let now = 0, calls = 0;
  const cache = createReportCache({ now: () => now, ttlMs: 10, maxEntries: 1 });
  const job = deferred();
  const first = cache("same", () => { calls++; return job.promise; });
  assert.equal(cache("same", () => { throw Error("duplicate"); }), first);
  assert.throws(() => cache("other", async () => "other"), /busy/);
  job.resolve("result");
  assert.equal(await first, "result");
  assert.equal(await cache("same", async () => "unexpected"), "result");
  now = 11;
  assert.equal(await cache("same", async () => { calls++; return "fresh"; }), "fresh");
  assert.equal(calls, 2);
  await assert.rejects(cache("failure", async () => { throw Error("failure"); }));
  assert.equal(await cache("failure", async () => "retry"), "retry");
});

test("cache identity includes owner, session, transcript, canonical context, model, provider and prompt version", () => {
  const input = { resourceId: "owner", threadId: "session", transcript, additionalContext: { b: 2, a: 1 }, provider: "openai", model: "model", promptVersion: "v1" };
  const key = reportCacheKey(input);
  assert.equal(key, reportCacheKey({ ...input, additionalContext: { a: 1, b: 2 } }));
  for (const field of ["resourceId", "threadId", "transcript", "provider", "model", "promptVersion"]) assert.notEqual(key, reportCacheKey({ ...input, [field]: "different" }));
  assert.notEqual(key, reportCacheKey({ ...input, additionalContext: { a: 2 } }));
});

test("summary and annotations start concurrently; ready summary returns while annotations remain in flight", async () => {
  const summary = deferred(), notes = deferred();
  const starts = [], usage = [];
  let active = 0;
  const workflow = {
    REPORT_PROMPT_VERSION: "test",
    generateReportSummary: async () => { starts.push("summary"); return summary.promise; },
    generateReportAnnotations: async () => { starts.push("annotations"); return notes.promise; },
    reportResult: (summaryAnalysis, annotationSegments) => ({ summaryAnalysis, annotationSegments }),
  };
  const service = loadReportService(workflow, { resolveTextProvider: () => ({ provider: "openai", model: "test" }) }, {
    reserveGeneration: (identity, cost) => { active++; usage.push({ identity, cost }); return () => active--; },
  });
  const input = { transcript, resourceId: "owner", threadId: "session" };
  const early = service.getReport(input, "summary");
  await turn();
  assert.deepEqual(starts, ["summary", "annotations"]);
  assert.equal(active, 2);
  summary.resolve("Ready summary");
  const result = await early;
  assert.equal(result.summaryAnalysis, "Ready summary");
  assert.equal(result.annotationStatus, "pending");
  assert.equal(active, 1);
  const late = service.getReport(input, "annotations");
  const complete = service.getReport(input, "complete");
  const segments = locations.buildAnnotationSegments(transcript, plan);
  notes.resolve(segments);
  assert.deepEqual((await late).annotationSegments, segments);
  assert.equal((await complete).annotationStatus, "ready");
  assert.deepEqual(starts, ["summary", "annotations"]);
  assert.equal(active, 0);
  assert.equal(usage.reduce((sum, call) => sum + call.cost, 0), 8);
});

test("failed warmed annotations do not lose a successful summary and can retry", async () => {
  let summaryCalls = 0, noteCalls = 0;
  const workflow = {
    REPORT_PROMPT_VERSION: "test", reportResult: (summaryAnalysis, annotationSegments) => ({ summaryAnalysis, annotationSegments }),
    generateReportSummary: async () => { summaryCalls++; return "Summary"; },
    generateReportAnnotations: async () => { if (++noteCalls === 1) throw Error("synthetic failure"); return locations.buildAnnotationSegments(transcript, plan); },
  };
  const service = loadReportService(workflow, { resolveTextProvider: () => ({ provider: "openai", model: "test" }) }, { reserveGeneration: () => () => {} });
  const input = { transcript, resourceId: "owner", threadId: "session" };
  assert.equal((await service.getReport(input, "summary")).summaryAnalysis, "Summary");
  await turn();
  assert.equal((await service.getReport(input, "annotations")).annotationStatus, "ready");
  assert.equal((await service.getReport(input, "complete")).summaryAnalysis, "Summary");
  assert.equal(summaryCalls, 1);
  assert.equal(noteCalls, 2);
});

test("annotation completion preserves summary, handles stale responses and leaves failed notes retryable", async () => {
  const raw = JSON.stringify({ sessionId: "session", transcript, summary: "Saved summary", annotationStatus: "pending", additionalContext: { scenario: "context" } });
  let stored = raw;
  const storage = { getItem: () => stored, setItem: (key, value) => { assert.equal(key, "reportData"); stored = value; } };
  const controller = new AbortController();
  const segments = locations.buildAnnotationSegments(transcript, plan);
  const response = () => Response.json({ status: "success", result: { annotationSegments: segments } });
  const success = await completeReportAnnotations({ raw, storage, signal: controller.signal, fetch: async function (_, options) {
    assert.equal(this, undefined, "Native browser fetch requires a direct call without the options receiver");
    assert.equal(JSON.parse(options.body).stage, "annotations"); return response();
  } });
  assert.equal(success, true);
  assert.equal(JSON.parse(stored).summary, "Saved summary");
  assert.equal(JSON.parse(stored).transcript, transcript);
  assert.equal(JSON.parse(stored).annotationStatus, "ready");
  stored = raw;
  await assert.rejects(completeReportAnnotations({ raw, storage, signal: controller.signal, fetch: async () => Response.json({}, { status: 502 }) }));
  assert.equal(stored, raw);
  assert.equal(await completeReportAnnotations({ raw, storage, signal: controller.signal, fetch: async () => { stored = "new report"; return response(); } }), false);
  assert.equal(stored, "new report");
  stored = raw;
  controller.abort();
  assert.equal(await completeReportAnnotations({ raw, storage, signal: controller.signal, fetch: async () => response() }), false);
  assert.equal(stored, raw);
});

test("installed structured-output runtime validates annotation JSON with no provider calls", async () => {
  const { backendRequire } = await import("./backend-runtime.mjs");
  const { Agent } = backendRequire("@mastra/core/agent");
  const agent = new Agent({ name: "annotation-runtime-test", instructions: "Return the supplied plan.", model: {
    specificationVersion: "v2", provider: "synthetic", modelId: "test", supportedUrls: {},
    doStream: async () => ({ stream: new ReadableStream({ start(controller) {
      controller.enqueue({ type: "stream-start", warnings: [] });
      controller.enqueue({ type: "text-start", id: "1" });
      controller.enqueue({ type: "text-delta", id: "1", delta: JSON.stringify(plan) });
      controller.enqueue({ type: "text-end", id: "1" });
      controller.enqueue({ type: "finish", finishReason: "stop", usage: { inputTokens: 5, outputTokens: 10 } });
      controller.close();
    } }) }),
  } });
  const workflow = loadReportWorkflow({
    "../agents/transcriptSummaryAnalyzerAgent": { transcriptSummaryAnalyzerAgent: {} },
    "../agents/reportAnnotationAgent": { reportAnnotationAgent: agent },
  }, { resolveTextProvider: () => ({ provider: "openai", model: "synthetic" }) });
  const segments = await workflow.generateReportAnnotations({ transcript });
  assert.equal(segments.map((segment) => segment.content).join("\n"), transcript);
});

test("invalid final JSON and provider failures produce safe errors and failed timing records", async () => {
  const logs = [];
  const info = console.info;
  console.info = (line) => logs.push(JSON.parse(line));
  try {
    for (const response of [
      { text: '{"segments":', object: plan, finishReason: "stop" },
      { text: JSON.stringify({ segments: [{ ...plan.segments[0], startLine: 99 }] }), finishReason: "stop" },
      { text: JSON.stringify(plan), finishReason: "length" },
      { text: JSON.stringify(plan), finishReason: "content-filter" },
      Error("private transcript and credential"),
    ]) {
      const workflow = loadReportWorkflow({
        "../agents/transcriptSummaryAnalyzerAgent": { transcriptSummaryAnalyzerAgent: {} },
        "../agents/reportAnnotationAgent": { reportAnnotationAgent: { generateVNext: async () => {
          if (response instanceof Error) throw response;
          return { ...response, usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 } };
        } } },
      }, { resolveTextProvider: () => ({ provider: "openai", model: "synthetic" }) });
      await assert.rejects(workflow.generateReportAnnotations({ transcript }), (error) => {
        assert.doesNotMatch(error.message, /private|credential|segments/); return true;
      });
      assert.equal(logs.at(-1).succeeded, false);
      assert.equal(logs.at(-1).stage, "annotations");
      assert.equal(typeof logs.at(-1).durationMs, "number");
    }
    assert.equal(logs[0].inputTokens, 10);
    assert.equal(logs[0].outputTokens, 20);
    assert.equal(logs[0].totalTokens, 30);
    assert.doesNotMatch(JSON.stringify(logs), /private|credential|Hello/);
  } finally { console.info = info; }
});


test("Bart's highlights are discarded while valid user notes survive, and unique misnumbered quotes recover", () => {
  const source = "user: What happened?\nbart: I missed the deadline.\nuser: Thanks for explaining.";
  let rejected = 0;
  const segments = locations.buildAnnotationSegments(source, { segments: [{ title: "Deadline", startLine: 0, highlights: [
    { line: 1, quote: "I missed the deadline.", occurrence: 0, color: "yellow", feedback: "This belongs to Bart." },
    { line: 1, quote: "Thanks for explaining.", occurrence: 0, color: "green", feedback: "Acknowledges the explanation." },
  ] }] }, () => rejected++);
  assert.equal(rejected, 1);
  assert.equal(segments[0].content, source);
  assert.equal(segments[0].highlights.length, 1);
  const note = segments[0].highlights[0];
  assert.equal(source.slice(note.start, note.end), "Thanks for explaining.");
  assert.equal(note.feedback, "Acknowledges the explanation.");
});
