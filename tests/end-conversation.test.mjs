import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = ts.transpileModule(
  readFileSync(
    new URL("../src/cedar/components/chatComponents/SidePanelCedarChat.tsx", import.meta.url),
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

// Render SidePanelCedarChat with state that survives re-renders, and drive End conversation
// through the real handler. Effects are not run; End does not depend on them.
function sidePanel({ stop = async () => {} } = {}) {
  const slots = [];
  let cursor = 0;
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    Fragment: "Fragment",
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [
        slots[index],
        (next) => (slots[index] = typeof next === "function" ? next(slots[index]) : next),
      ];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useEffect() {},
  };
  const cedar = {
    mainThreadId: "thread",
    isProcessing: false,
    getThreadMessages: () => [{ role: "user", type: "text", content: "Hello" }],
  };
  const useCedarStore = (selector) => selector(cedar);
  useCedarStore.getState = () => cedar;
  const pushes = [];
  const reports = [];
  const mocks = {
    react: { __esModule: true, default: react, ...react },
    "cedar-os": {
      useCedarStore,
      useThreadMessages: () => ({ messages: [] }),
      useRegisterState() {},
      useStateBasedMentionProvider() {},
      useCedarState() {},
      useSubscribeStateToAgentContext() {},
    },
    "dotenv/config": {},
    "@/app/report/parser": {
      __esModule: true,
      default: () => ({ status: "ready", summary: "Summary", segments: [{}] }),
    },
    "@/lib/completedScenarios": { recordCompletedScenario() {} },
    "@/lib/reportTranscript": { buildReportTranscript: () => "user: Hello" },
    "@/cedar/components/chatInput/ChatInput": { ChatInput: () => null },
    "@/cedar/components/chatMessages/ChatBubbles": { __esModule: true, default: () => null },
    "next/navigation": { useRouter: () => ({ push: (path) => pushes.push(path) }) },
    "@/components/ui/button": { Button: "button" },
    "lucide-react": { CircleAlert: "svg" },
    "motion/react": { AnimatePresence: "div", motion: { div: "div", path: "path" }, useReducedMotion: () => false },
    "@/lib/scenarioUtil": { contextForAnalysis: () => ({}) },
    "@/backend/src/lib/scenarios": { Scenarios: { negativeReview: {} } },
    "@/lib/sentiment": { analyzeSentiment: async () => ({}) },
    "@/hooks/useVoiceSession": { useVoiceSession: () => ({ provider: "deepgram", stop: () => stop(cedar) }) },
  };
  const loaded = { exports: {} };
  new Function("require", "module", "exports", "fetch", "localStorage", source)(
    (id) => {
      assert.ok(Object.hasOwn(mocks, id), "unexpected SidePanelCedarChat import: " + id);
      return mocks[id];
    },
    loaded,
    loaded.exports,
    async (url) => {
      reports.push(url);
      return Response.json({ status: "success", result: { summaryAnalysis: "Summary" } });
    },
    { setItem() {}, getItem: () => null },
  );
  const render = () => {
    cursor = 0;
    return loaded.exports.SidePanelCedarChat({ setUserSentiment() {} });
  };
  const find = (node, text) => {
    if (!node || typeof node !== "object") return;
    if (node.props?.children?.includes?.(text)) return node;
    return [node.props?.children].flat(Infinity).map((child) => find(child, text)).find(Boolean);
  };
  return {
    endButton: () => find(render(), "End conversation"),
    shows: (text) => Boolean(find(render(), text)),
    pushes,
    reports,
  };
}

test("End stays disabled after a successful debrief until the report page loads", async () => {
  const panel = sidePanel();
  await panel.endButton().props.onClick();
  assert.deepEqual(panel.pushes, ["/report"]);
  // The navigation is still pending: a second press must not start another paid report.
  assert.equal(panel.endButton().props.disabled, true);
  await panel.endButton().props.onClick();
  assert.equal(panel.reports.length, 1);
});

test("End waits for a typed reply that started while voice was saving", async () => {
  let typed;
  const panel = sidePanel({
    stop: async (cedar) => {
      typed = cedar;
      cedar.isProcessing = true;
    },
  });
  await panel.endButton().props.onClick();
  assert.equal(panel.reports.length, 0);
  assert.deepEqual(panel.pushes, []);
  assert.ok(panel.shows("Wait for Bart's reply, then end the conversation."));
  // Once Bart's reply lands, End works again and the report includes it.
  typed.isProcessing = false;
  assert.equal(panel.endButton().props.disabled, false);
});
