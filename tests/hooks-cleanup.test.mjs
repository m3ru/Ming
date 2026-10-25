import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);

// Run the components' real effect bodies with controlled renders and clocks.
// This keeps animation and timer regressions independent of a browser's frame rate.
function createHookHarness() {
  const slots = [];
  let cursor = 0;
  let pendingEffects = [];
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) {
        slots[index] = typeof initial === "function" ? initial() : initial;
      }
      return [slots[index], (next) => {
        slots[index] = typeof next === "function" ? next(slots[index]) : next;
      }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useEffect(effect, dependencies) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) {
        pendingEffects.push(() => {
          previous?.cleanup?.();
          slots[index] = { dependencies, cleanup: effect() };
        });
      }
    },
  };
  return {
    hooks,
    render(Component, props) {
      cursor = 0;
      pendingEffects = [];
      const result = Component(props);
      for (const effect of pendingEffects) effect();
      return result;
    },
    unmount() {
      for (const slot of slots) slot?.cleanup?.();
    },
  };
}

function loadComponent(path, hooks, mocks = {}, clock = {}) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", "Date", "setInterval", "clearInterval", outputText)(
    (id) => {
      if (id === "react") return hooks;
      if (Object.hasOwn(mocks, id)) return mocks[id];
      if (id === "react/jsx-runtime") return require(id);
      throw new Error(`Unexpected component import: ${id}`);
    },
    module,
    module.exports,
    clock.Date ?? Date,
    clock.setInterval ?? setInterval,
    clock.clearInterval ?? clearInterval,
  );
  return module.exports;
}

test("typing keeps its animation during callback updates and invokes the latest completion", () => {
  const harness = createHookHarness();
  const animations = [];
  const calls = [];
  const { TypewriterText } = loadComponent(
    "../src/cedar/components/text/TypewriterText.tsx",
    harness.hooks,
    {
      "cedar-os": { useStyling: () => ({ styling: {} }) },
      "../chatMessages/MarkdownRenderer": () => null,
      "motion/react": {
        motion: { span: "span" },
        animate(from, to, options) {
          const animation = { from, to, options, stopped: false };
          animations.push(animation);
          return { stop() { animation.stopped = true; } };
        },
      },
    },
  );
  const props = {
    text: "Hello",
    charDelay: 0.1,
    onTypingStart: () => calls.push("initial start"),
    onTypingComplete: () => calls.push("initial completion"),
  };
  harness.render(TypewriterText, props);
  animations[0].options.onUpdate(2);
  const updatedProps = {
    ...props,
    onTypingStart: () => calls.push("updated start"),
    onTypingComplete: () => calls.push("updated completion"),
  };
  harness.render(TypewriterText, updatedProps);
  assert.equal(animations.length, 1);
  assert.equal(animations[0].stopped, false);
  assert.equal(animations[0].options.duration, 0.5);
  animations[0].options.onComplete();
  assert.deepEqual(calls, ["initial start", "updated completion"]);

  harness.render(TypewriterText, { ...updatedProps, text: "Changed" });
  assert.equal(animations.length, 2);
  assert.equal(animations[0].stopped, true);
  assert.equal(calls.at(-1), "updated start");
  harness.render(TypewriterText, { ...updatedProps, text: "Changed", charDelay: 0.2 });
  assert.equal(animations.length, 3);
  assert.equal(animations[1].stopped, true);
  harness.unmount();
  assert.equal(animations[2].stopped, true);
});

test("sentiment movement uses each interval's elapsed time and retargets cleanly", () => {
  const harness = createHookHarness();
  let now = 0;
  const intervals = new Map();
  let nextInterval = 0;
  const { default: SentimentBar } = loadComponent(
    "../src/components/SentimentBar.tsx",
    harness.hooks,
    {},
    {
      Date: { now: () => now },
      setInterval(callback) {
        const id = ++nextInterval;
        intervals.set(id, callback);
        return id;
      },
      clearInterval: (id) => intervals.delete(id),
    },
  );
  let result = harness.render(SentimentBar, { sentiment: 1 });
  for (let i = 0; i < 100; i++) {
    now += 10;
    for (const tick of intervals.values()) tick();
    result = harness.render(SentimentBar, { sentiment: 1 });
  }
  const width = (tree) => parseFloat(tree.props.children.props.children[0].props.style.width);
  assert.ok(Math.abs(width(result) - 55) < 1e-9);
  assert.equal(nextInterval, 1, "display updates keep the existing timer");

  now += 5000;
  harness.render(SentimentBar, { sentiment: -1 });
  assert.equal(intervals.size, 1);
  now += 10;
  for (const tick of intervals.values()) tick();
  result = harness.render(SentimentBar, { sentiment: -1 });
  assert.ok(Math.abs(width(result) - 54.95) < 1e-9);
  harness.unmount();
  assert.equal(intervals.size, 0);
});
