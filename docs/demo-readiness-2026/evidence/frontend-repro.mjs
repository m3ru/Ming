// Offline audit reproductions. These assert the defects observed on 2026-10-24;
// a corrected implementation should make the corresponding assertion fail.
// Run from any directory with Node >=22.13: node <path>/frontend-repro.mjs
// Reads current repository sources. No network, browser, model calls, or writes.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const sources = new Map();
function read(relative) {
  const source = readFileSync(new URL(relative, "file://" + root), "utf8");
  sources.set(relative, source);
  return source;
}
function extract(source, pattern, description) {
  const match = source.match(pattern);
  assert.ok(match, "Cannot locate current " + description + "; update the harness.");
  return match[1];
}
function context(globals = {}) {
  return vm.createContext({ console, ...globals });
}
function evaluate(source, sandbox) {
  return vm.runInContext(stripTypeScriptTypes(source), sandbox);
}
function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

console.log("Frontend offline audit evidence");
console.log("Node: " + process.version);
console.log("Harness evaluates extracted current source with synthetic data and in-memory doubles.");
console.log("This is logic evidence, not a React/browser or production end-to-end test.\n");

// Parser contains no JSX. Load its actual evaluation dependency into the same VM;
// only remove module syntax so the local import alias does not require a bundler.
const evaluationSource = read("src/lib/evaluation.ts").replace(/^export /gm, "");
const parserSource = read("src/app/report/parser.tsx")
  .replace(/import \{[\s\S]*?from "@\/lib\/evaluation";/, "")
  .replace("export default function Parser", "function Parser");
const parserContext = context();
evaluate(evaluationSource + "\n" + parserSource + "\nglobalThis.parseReport = Parser;", parserContext);
const missingRating = parserContext.parseReport(JSON.stringify({
  summary: "## CONVERSATION OVERVIEW\nSynthetic conversation for an offline audit.",
  detail: "",
}));
const fallbackScores = Array.from(missingRating.scores, (item) => item.score);
const evaluationScores = Array.from(missingRating.evaluation, (item) => item.score);
assert.deepEqual(fallbackScores, [85, 90, 80, 75, 88, 99]);
assert.deepEqual(evaluationScores, [null, null, null, null, null, null]);
console.log("CONFIRMED: Missing-rating payload returns fabricated parser scores: " + JSON.stringify(fallbackScores));
console.log("Same payload returns null evaluation scores: " + JSON.stringify(evaluationScores));
const controlScores = [11, 22, 33, 44, 55, 66];
const categories = ["Empathy", "Clarity", "Open-mindedness", "Assertiveness", "Active Listening", "Conflict Management"];
const rated = parserContext.parseReport(JSON.stringify({
  summary: "## RATING\n" + categories.map((name, index) => "- " + name + ": " + controlScores[index] + "/100").join("\n"),
  detail: "",
}));
assert.deepEqual(Array.from(rated.scores, (item) => item.score), controlScores);
assert.deepEqual(Array.from(rated.evaluation, (item) => item.score), controlScores);
console.log("CONTROL: A complete six-rating payload preserves the same real scores in both outputs.\n");

const scenarioPage = read("src/app/scenario/page.tsx");
const completionBody = extract(scenarioPage,
  /const checkScenarioCompletion = \(\) => \{([\s\S]*?)\n  \};/,
  "completion check");
const completionStorage = storage();
let generated = 0;
const completionContext = context({
  localStorage: completionStorage,
  scenarioCompleted: false,
  setScenarioCompleted: () => {},
  generateNewScenarioPrompt: () => { generated++; },
});
// The actual page invokes this function on mount and on each visible event.
for (let call = 0; call < 3; call++) evaluate("(function(){" + completionBody + "})()", completionContext);
assert.equal(completionStorage.getItem("numScenariosCompleted"), "3");
assert.equal(generated, 0);
assert.equal(completionStorage.getItem("reportData"), null);
assert.equal(completionStorage.getItem("scenarioCompleted"), null);
console.log("CONFIRMED: Simulated mount plus two visible-event checks records 3 completions with no report or completion flag.");
console.log("CONTROL: The next-scenario workflow double was invoked 0 times.\n");

const chatInput = read("src/cedar/components/chatInput/ChatInput.tsx");
const keyBody = extract(chatInput,
  /const handleKeyDown = \(e: KeyboardEvent\) => \{([\s\S]*?)\n    \};/,
  "global keyboard handler");
for (const shiftKey of [false, true]) {
  let prevented = false;
  let focused = false;
  const keyContext = context({
    e: { key: "Tab", shiftKey, preventDefault: () => { prevented = true; } },
    editor: { commands: { focus: () => { focused = true; } } },
    setIsFocused: () => {},
    isFocused: false,
  });
  evaluate("(function(){" + keyBody + "})()", keyContext);
  assert.equal(prevented, true);
  assert.equal(focused, true);
  console.log("CONFIRMED: " + (shiftKey ? "Shift+Tab" : "Tab") + " default traversal is prevented and editor focus is forced.");
}
let unrelatedPrevented = false;
evaluate("(function(){" + keyBody + "})()", context({
  e: { key: "ArrowDown", preventDefault: () => { unrelatedPrevented = true; } },
  editor: null,
  isFocused: false,
  setIsFocused: () => {},
}));
assert.equal(unrelatedPrevented, false);
console.log("CONTROL: ArrowDown is not intercepted.\n");

// No DOM implementation is installed. Exercise the actual storage consumer with
// a parser boundary spy, then the actual XML wrapper. Do not emulate DOMParser.
const scenarioUtil = read("src/lib/scenarioUtil.ts");
const getterBody = extract(scenarioUtil,
  /export function getScenarioFromLocalStorage\(\): Scenario \| undefined \{([\s\S]*?)\n\}/,
  "scenario storage consumer");
const wrapperBody = extract(scenarioUtil,
  /function formatXml\(xml: string\): string \{([\s\S]*?)\n\}/,
  "scenario XML wrapper");
assert.match(scenarioPage, /reports:\s*\(result as any\)\.result\.reports/);
const syntheticPackage = {
  scenario: "<scenario_title>Synthetic audit scenario</scenario_title>",
  prompts: "<personality_llm>Synthetic audit personality</personality_llm>",
  reports: "<document_1>Synthetic supporting report\nA synthetic fact.</document_1>",
};
let captured;
evaluate("(function(){" + getterBody + "})()", context({
  localStorage: storage({ scenarioData: JSON.stringify(syntheticPackage) }),
  parseScenario: (...args) => { captured = args; return {}; },
}));
assert.equal(captured[0], syntheticPackage.scenario);
assert.equal(captured[1], syntheticPackage.prompts);
assert.equal(captured[2], undefined);
const wrapped = evaluate("(function(xml){" + wrapperBody + "})(undefined)", context());
assert.equal(wrapped, "<root>undefined</root>");
console.log("CONFIRMED: Actual scenarioData getter passes undefined as document input when the producer stores reports.");
console.log("Actual XML wrapper then produces: " + wrapped);
console.log("CONTROL: Scenario and prompt arguments remain intact. DOM parsing/rendering was not exercised.\n");

console.log("Source SHA-256 at reproduction time:");
for (const [path, source] of sources) {
  console.log(createHash("sha256").update(source).digest("hex") + "  " + path);
}
console.log("\nAll observed-defect assertions and controls passed.");
