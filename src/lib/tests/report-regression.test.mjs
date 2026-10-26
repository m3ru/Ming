// Runtime regressions for report integrity; no provider, browser, or network required.
// Run: node --test src/lib/tests/report-regression.test.mjs
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
const rootRequire = createRequire(join(root, "package.json"));

// Compile the actual TS/TSX implementation in memory. Overrides isolate page
// rendering from routing and the Cedar service, not from the report parser.
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
        const target = [base, base + ".ts", base + ".tsx"].find((path) =>
          existsSync(path),
        );
        if (target) return load(target);
      }
      return rootRequire(specifier);
    };
    loaded._compile(compiled.outputText, filename);
    return loaded.exports;
  };
}

const load = loader();
const { default: parse, emptyReportScores } = load("src/app/report/parser.tsx");
const { default: AnnotatedTranscript, ReportMarkdown } = load(
  "src/components/AnnotatedTranscript.tsx",
);
const { default: ScoreBar } = load("src/components/ScoreBar.tsx");
const categories = [
  "Empathy",
  "Clarity",
  "Open-mindedness",
  "Assertiveness",
  "Active Listening",
  "Conflict Management",
];
const complete = {
  sessionId: "session-regression",
  createdAt: "2026-10-24T14:00:00.000Z",
  transcript: "user: Hello\nbart: Hi",
  summary:
    "## CONVERSATION OVERVIEW\nA concrete conversation.\n\n## USER PERFORMANCE ANALYSIS\nYou clarified the next step.\n\n## RATING\n" +
    categories
      .map((category, index) => `- ${category}: ${index * 10}/100`)
      .join("\n") +
    "\n\n## IMPROVEMENT RECOMMENDATIONS\nConfirm the agreed next step.",
  detail: "<segment: Opening>user: Hello\n\nbart: Hi</segment: Opening>",
};
const scoreValues = (result) => result.scores.map(({ score }) => score);

test("a complete report retains actual scores, transcript, and session metadata", () => {
  const result = parse(JSON.stringify(complete));
  assert.equal(result.status, "ready");
  assert.equal(result.summary, "A concrete conversation.");
  assert.equal(result.feedback, "You clarified the next step.");
  assert.equal(result.suggestions, "Confirm the agreed next step.");
  assert.equal(result.segments.length, 1);
  assert.match(result.segments[0].content, /\*\*User:\*\* Hello/);
  assert.deepEqual(scoreValues(result), [0, 10, 20, 30, 40, 50]);
  assert.deepEqual(
    result.evaluation.map(({ score }) => score),
    scoreValues(result),
  );
  assert.equal(result.sessionId, complete.sessionId);
  assert.equal(result.transcript, complete.transcript);
  assert.equal(result.createdAt, complete.createdAt);
});

test("missing rating section stays null across parsing, evaluation, and serialized context", () => {
  const result = parse(
    JSON.stringify({
      ...complete,
      summary: complete.summary.replace(
        /## RATING[\s\S]*?(?=## IMPROVEMENT)/,
        "",
      ),
    }),
  );
  assert.equal(result.status, "partial");
  assert.deepEqual(scoreValues(result), Array(6).fill(null));
  assert.deepEqual(
    result.evaluation.map(({ score }) => score),
    Array(6).fill(null),
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify({ scores: result.scores })).scores.map(
      ({ score }) => score,
    ),
    Array(6).fill(null),
  );
});

test("the actual coaching state preserves null scores and explains their meaning", () => {
  const registrations = [];
  const coachingLoad = loader({
    "cedar-os": {
      useCedarStore: (selector) =>
        selector({
          createThread: () => "thread",
          switchThread: () => {},
          clearMessages: () => {},
        }),
      useRegisterState: (config) => registrations.push(config),
      useStateBasedMentionProvider: () => {},
      useSubscribeStateToAgentContext: () => {},
    },
    "@/cedar/components/chatInput/ChatInput": { ChatInput: () => null },
    "@/cedar/components/chatMessages/ChatBubbles": () => null,
    "./TranscriptChatPanel.css": {},
  });
  const Panel = coachingLoad("src/components/TranscriptChatPanel.tsx").default;
  const scores = emptyReportScores();
  renderToStaticMarkup(
    React.createElement(Panel, {
      segments: [],
      feedback: null,
      suggestions: null,
      scores,
    }),
  );
  const context = registrations.find(
    ({ key }) => key === "transcriptAnalysisContext",
  ).value;
  assert.deepEqual(
    context.scores.map(({ score }) => score),
    Array(6).fill(null),
  );
  assert.equal(context.feedback, null);
  assert.match(context.scoreAvailability, /Never infer a numeric score/);
});

test("coach mentions keep feedback that quotes a phrase", () => {
  const registrations = [];
  let inputProps;
  const coachingLoad = loader({
    "cedar-os": {
      useCedarStore: (selector) =>
        selector({ createThread: () => "thread", switchThread: () => {}, clearMessages: () => {} }),
      useRegisterState: (config) => registrations.push(config),
      useStateBasedMentionProvider: () => {},
      useSubscribeStateToAgentContext: () => {},
    },
    "@/cedar/components/chatInput/ChatInput": { ChatInput: (props) => ((inputProps = props), null) },
    "@/cedar/components/chatMessages/ChatBubbles": () => null,
    "./TranscriptChatPanel.css": {},
  });
  const Panel = coachingLoad("src/components/TranscriptChatPanel.tsx").default;
  renderToStaticMarkup(
    React.createElement(Panel, {
      segments: [
        {
          title: "Review",
          content:
            '**User:** <comment color="red" feedback="Say "I hear you" first.">Calm down.</comment> ' +
            '<comment feedback="Good question." color="green">Why?</comment>',
        },
      ],
      feedback: null,
      suggestions: null,
      scores: emptyReportScores(),
    }),
  );
  const mentions = registrations.find(({ key }) => key === "transcriptFeedback").value;
  assert.deepEqual(mentions.map(({ feedback }) => feedback), ['Say "I hear you" first.', "Good question."]);
  // Space scrolls the report rather than opening the microphone.
  assert.equal(inputProps.spaceToTalk, false);
});

test("partial and malformed ratings never invent or clamp numbers", () => {
  const result = parse(
    JSON.stringify({
      summary:
        "## RATING\n- Empathy: 101\n- Clarity: -5\n- Open Mindness: 82.5/100\n- Assertiveness: NaN\n- Active Listening: 0\n- Conflict Management: 1/5",
      detail: "",
    }),
  );
  assert.equal(result.status, "partial");
  assert.deepEqual(scoreValues(result), [null, null, 82.5, null, 0, null]);
  assert.deepEqual(
    result.evaluation.map(({ score }) => score),
    scoreValues(result),
  );
  const ambiguous = parse(
    JSON.stringify({
      summary: "## RATING\n- Empathy: 20\n- Empathy: 30\n- Empathy: 20",
    }),
  );
  assert.equal(ambiguous.scores[0].score, null);
});

test("malformed JSON and unexpected field types return recoverable invalid reports", () => {
  for (const raw of [
    "",
    "{",
    "null",
    "[]",
    "3",
    "{}",
    '{"summary":42,"detail":{"bad":true}}',
    '{"summary":"provider failed","detail":""}',
  ]) {
    const result = parse(raw);
    assert.equal(result.status, "invalid", raw);
    assert.deepEqual(scoreValues(result), Array(6).fill(null), raw);
    assert.ok(result.issues.length, raw);
  }
});

test("malformed and empty segments remain unavailable; valid content is retained as partial", () => {
  const result = parse(
    JSON.stringify({
      summary: "## CONVERSATION OVERVIEW\nAvailable summary.",
      detail: "<segment: Empty> </segment: Empty><segment: Broken>Text with no closing tag",
    }),
  );
  assert.equal(result.status, "partial");
  assert.equal(result.summary, "Available summary.");
  assert.deepEqual(result.segments, []);
  const empty = renderToStaticMarkup(
    React.createElement(AnnotatedTranscript, { segments: result.segments }),
  );
  assert.match(empty, /No annotated transcript is available/);
  assert.doesNotMatch(
    readFileSync(join(root, "src/components/AnnotatedTranscript.tsx"), "utf8"),
    /fetch\(|sample\.md/,
  );
});

test("segments match the backend's rule: any case, padded titles, any closing title", () => {
  // The backend feeds these same segments to the detail agent (backend-streaming tests).
  const result = parse(
    JSON.stringify({
      ...complete,
      detail: "<Segment: Opening >user: Hello</segment: Opening>\n<segment:Close>user: Bye</SEGMENT:close>",
    }),
  );
  assert.equal(result.status, "ready");
  assert.deepEqual(result.segments.map(({ title }) => title), ["Opening", "Close"]);
});

test("margin notes sit on the row of the line they annotate, and tags spanning lines stay intact", () => {
  const content = [
    "**User:** Hello there.",
    "**Bart:** Hi, thanks for meeting.",
    '**User:** <comment color="red" feedback="Too blunt">Explain yourself.</comment>',
    "**Bart:** I will try.",
    '**User:** <comment color="green" feedback="Kind close">Thanks for',
    "being honest.</comment>",
  ].join("\n");
  const markup = renderToStaticMarkup(
    React.createElement(AnnotatedTranscript, { segments: [{ title: "Review", content }] }),
  );
  const at = (text) => {
    const index = markup.indexOf(text);
    assert.ok(index >= 0, "missing " + text);
    return index;
  };
  // Note 1 belongs to the third line: after it, and before the fourth line.
  assert.ok(at("Explain yourself.") < at("Too blunt"));
  assert.ok(at("Too blunt") < at("I will try."));
  assert.ok(at("Hi, thanks for meeting.") < at("Explain yourself."));
  // A highlight wrapped across a line break is parsed, not shown as raw tags.
  assert.doesNotMatch(markup, /&lt;comment|&lt;\/comment/);
  assert.ok(at("being honest.") < at("Kind close"));
});

test("an unclosed note tag stays on its own line and keeps every note", () => {
  const content = [
    '**User:** <comment color="red" feedback="Too blunt">Explain yourself.',
    "**Bart:** I will try.",
    '**User:** <comment color="green" feedback="Kind close">Thanks.</comment>',
  ].join("\n");
  const markup = renderToStaticMarkup(
    React.createElement(AnnotatedTranscript, { segments: [{ title: "Review", content }] }),
  );
  const at = (text) => {
    const index = markup.indexOf(text);
    assert.ok(index >= 0, "missing " + text);
    return index;
  };
  assert.doesNotMatch(markup, /&lt;comment|&lt;\/comment/);
  assert.ok(at("Explain yourself.") < at("Too blunt"));
  assert.ok(at("Too blunt") < at("I will try."));
  assert.ok(at("I will try.") < at("Thanks."));
  assert.ok(at("Thanks.") < at("Kind close"));
});

test("a margin note that quotes a phrase keeps its full text", () => {
  const markup = renderToStaticMarkup(
    React.createElement(AnnotatedTranscript, {
      segments: [
        {
          title: "Review",
          content: '**User:** <comment color="red" feedback="Say "I hear you" first, then explain.">Calm down.</comment>',
        },
      ],
    }),
  );
  assert.match(markup, /Say &quot;I hear you&quot; first, then explain\./);
  assert.match(markup, /Calm down\./);
  assert.doesNotMatch(markup, /&lt;comment/);
});

test("restricted Markdown preserves formatting and excludes HTML, images, and unsafe URLs", () => {
  const content =
    "**Useful feedback**\n\n- A real point\n\n<img src=x onerror=alert(1)>\n\n<script>alert(2)</script>\n\n[unsafe](javascript:alert(3))\n\n![tracker](https://example.com/pixel)\n\n[safe](https://example.com/help)";
  const markup = renderToStaticMarkup(
    React.createElement(ReportMarkdown, null, content),
  );
  assert.match(markup, /<strong>Useful feedback<\/strong>/);
  assert.match(markup, /<li>A real point<\/li>/);
  assert.match(markup, /href="https:\/\/example.com\/help"/);
  assert.doesNotMatch(
    markup,
    /<img|<script|onerror|javascript:|pixel|alert\(2\)/i,
  );
});

test("score bars distinguish unknown scores from valid zero and reject corrupt numbers", () => {
  for (const score of [null, NaN, Infinity, -1, 101]) {
    const markup = renderToStaticMarkup(
      React.createElement(ScoreBar, { category: "Empathy", score }),
    );
    assert.match(markup, /Not scored/);
    assert.doesNotMatch(markup, /aria-valuenow=/);
  }
  const zero = renderToStaticMarkup(
    React.createElement(ScoreBar, { category: "Empathy", score: 0 }),
  );
  assert.match(zero, />0\/100</);
  assert.match(zero, /aria-valuenow="0"/);
  const defaults = emptyReportScores();
  defaults[0].score = 99;
  assert.equal(emptyReportScores()[0].score, null);
});

test("report coaching restores the prior thread and respects later thread changes", () => {
  for (const changeThreadBeforeCleanup of [false, true]) {
    let currentThread = "scenario-thread";
    const effects = [];
    const coachLoad = loader({
      react: { ...React, useEffect: (effect) => effects.push(effect) },
      "cedar-os": {
        useCedarStore: (selector) =>
          selector({
            createThread: (threadId) => threadId,
            switchThread: (threadId) => {
              currentThread = threadId;
            },
            clearMessages: () => {},
            getCurrentThreadId: () => currentThread,
          }),
        useRegisterState: () => {},
        useStateBasedMentionProvider: () => {},
        useSubscribeStateToAgentContext: () => {},
      },
      "@/cedar/components/chatInput/ChatInput": { ChatInput: () => null },
      "@/cedar/components/chatMessages/ChatBubbles": () => null,
      "./TranscriptChatPanel.css": {},
    });
    const Panel = coachLoad("src/components/TranscriptChatPanel.tsx").default;
    renderToStaticMarkup(
      React.createElement(Panel, {
        segments: [],
        feedback: null,
        suggestions: null,
        scores: emptyReportScores(),
      }),
    );
    const cleanup = effects[0]();
    assert.match(currentThread, /^transcript-/);
    if (changeThreadBeforeCleanup) currentThread = "another-scenario-thread";
    cleanup();
    assert.equal(
      currentThread,
      changeThreadBeforeCleanup ? "another-scenario-thread" : "scenario-thread",
    );
  }
});

function renderPage(state, hooks = {}) {
  const states = [
    true,
    true,
    state,
    hooks.followUpState || { status: "idle" },
  ];
  const wrapper = ({ children }) => React.createElement("div", null, children);
  const pageLoad = loader({
    react: {
      ...React,
      useState: () => [states.shift(), hooks.setState || (() => {})],
      useEffect: hooks.useEffect || (() => {}),
      useCallback: (callback) => callback,
    },
    "next/link": ({ children, href }) =>
      React.createElement("a", { href }, children),
    "@/components/TranscriptChatPanel": () =>
      React.createElement("p", null, "Coaching available"),
    "@/components/SessionActionsProvider": {
      useSessionActions: () => ({
        startNewSession: async () => {},
        isStarting: false,
        error: null,
      }),
    },
    "@/components/ui/button": {
      Button: ({ children, asChild, onClick }) =>
        asChild
          ? children
          : React.createElement("button", { onClick }, children),
    },
    "@/components/ui/collapsible": {
      Collapsible: wrapper,
      CollapsibleContent: wrapper,
      CollapsibleTrigger: wrapper,
    },
  });
  const Page = pageLoad("src/app/report/page.tsx").default;
  return renderToStaticMarkup(React.createElement(Page));
}

test("actual report loading handles missing, corrupt, and blocked storage without writing history", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  try {
    for (const [read, expected] of [
      [() => null, "empty"],
      [() => "{", "error"],
      [
        () => {
          throw new Error("Storage blocked");
        },
        "error",
      ],
      [() => JSON.stringify(complete), "loaded"],
    ]) {
      let writes = 0;
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: {
          getItem: read,
          setItem: () => {
            writes++;
          },
        },
      });
      const effects = [];
      const updates = [];
      renderPage(
        { status: "loading" },
        {
          useEffect: (effect) => effects.push(effect),
          setState: (value) => updates.push(value),
        },
      );
      assert.doesNotThrow(() => effects[0]());
      assert.equal(updates.at(-1)?.status, expected);
      assert.equal(writes, 0);
    }
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else delete globalThis.localStorage;
  }
});

test("empty and invalid report pages expose navigation without fake report content or export", () => {
  const empty = renderPage({ status: "empty" });
  assert.match(empty, /No report yet/);
  assert.match(empty, /href="\/scenario">Start scenario/);
  assert.doesNotMatch(
    empty,
    /Skill by skill|Annotated transcript|Print report|85\/100/,
  );
  const unavailable = renderPage({
    status: "error",
    message: "Saved report cannot be read.",
  });
  assert.match(unavailable, /Report unavailable/);
  assert.match(unavailable, /Return to scenario/);
  assert.match(unavailable, /Try loading again/);
  assert.match(unavailable, /retry End conversation/);
  assert.match(unavailable, /href="\/"/);
  assert.doesNotMatch(unavailable, /Print report/);
});

test("partial page renders available content with explicit gaps and safe summary output", () => {
  const report = parse(
    JSON.stringify({
      summary:
        "## CONVERSATION OVERVIEW\n**Actual summary**\n\n<img src=x onerror=alert(1)>",
    }),
  );
  const markup = renderPage({ status: "loaded", report });
  assert.match(markup, /Partial report/);
  assert.match(markup, /<strong>Actual summary<\/strong>/);
  assert.match(markup, /No annotated transcript is available/);
  assert.match(markup, /Not scored/);
  assert.doesNotMatch(markup, /<img|onerror|85\/100/);
});

test("follow-up controls precede the long transcript and failures keep the completed report readable", () => {
  const report = parse(JSON.stringify(complete));
  const state = {
    status: "loaded",
    report,
    source: {
      reportId: "source",
      threadId: complete.sessionId,
      rawReport: JSON.stringify(complete),
      analysis: complete.summary,
    },
  };
  const markup = renderPage(state, {
    followUpState: {
      status: "error",
      message: "Generation unavailable. Your report is still available.",
    },
  });
  assert.match(markup, /Retry follow-up/);
  assert.match(markup, /A concrete conversation/);
  assert.match(markup, /Print report/);
  assert.ok(
    markup.indexOf("Practice your next conversation") <
      markup.indexOf("Annotated transcript"),
  );
  const loading = renderPage(state, { followUpState: { status: "loading" } });
  assert.match(loading, /Generating your follow-up/);
  assert.match(loading, /Cancel generation/);
  assert.match(loading, /A concrete conversation/);
});

test("the report verdict names the strongest and weakest scored skills", () => {
  const { evaluationVerdict } = load("src/lib/evaluation.ts");
  const criteria = (scores) =>
    categories.map((category, i) => ({ category, score: scores[i] }));
  assert.deepEqual(evaluationVerdict(criteria([90, 92, 88, 85, 90, 85])), {
    strongest: "Clarity",
    workOn: "Assertiveness",
  });
  assert.deepEqual(evaluationVerdict(criteria([70, null, 90, 90, 40, 40])), {
    strongest: "Open-mindedness",
    workOn: "Active Listening",
  });
  assert.deepEqual(evaluationVerdict(criteria([80, 80, null, 80, 80, 80])), {
    strongest: "Empathy",
  });
  assert.deepEqual(
    evaluationVerdict(criteria([null, null, 0, null, null, null])),
    { strongest: "Open-mindedness" },
  );
  assert.equal(evaluationVerdict(criteria(Array(6).fill(null))), null);
});
