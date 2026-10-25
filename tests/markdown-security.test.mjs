import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const rootRequire = createRequire(import.meta.url);
const source = readFileSync(new URL("../src/cedar/components/chatMessages/MarkdownRenderer.tsx", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
  },
});
const componentModule = { exports: {} };
new Function("require", "module", "exports", outputText)(
  (id) => id === "cedar-os"
    ? { useStyling: () => ({ styling: { accentColor: "#2563eb", color: "#111827" } }) }
    : rootRequire(id),
  componentModule,
  componentModule.exports,
);
const { MarkdownRenderer } = componentModule.exports;

test("real markdown rendering blocks automatic images, raw HTML, and executable links", () => {
  const content = [
    "![tracking image](https://tracker.invalid/private-transcript)",
    '<img src="https://tracker.invalid/raw-image" onerror="alert(1)">',
    '<script src="https://tracker.invalid/script.js"></script>',
    '<iframe src="https://tracker.invalid/frame"></iframe>',
    "[unsafe link](javascript:alert%281%29)",
    "**Coaching text** and [safe link](https://example.com/help)",
  ].join("\n\n");
  const html = renderToStaticMarkup(React.createElement(MarkdownRenderer, { content }));
  assert.doesNotMatch(html, /<(?:img|script|iframe)\b/i);
  assert.doesNotMatch(html, /(?:src|href)=["'](?:https:\/\/tracker\.invalid|javascript:)/i);
  assert.doesNotMatch(html, /onerror=/i);
  assert.match(html, /<strong[^>]*>Coaching text<\/strong>/);
  assert.match(html, /href="https:\/\/example\.com\/help"/);
});
