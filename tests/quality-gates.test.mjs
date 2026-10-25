import assert from "node:assert/strict";
import { test } from "node:test";
import { loadBackendSource } from "./backend-runtime.mjs";

const { default: config } = loadBackendSource("next.config.ts");

test("frontend builds enforce checks and ship baseline security headers", async () => {
  assert.notEqual(config.typescript?.ignoreBuildErrors, true);
  assert.notEqual(config.eslint?.ignoreDuringBuilds, true);
  assert.equal(config.output, "standalone");
  const rules = await config.headers();
  assert.equal(rules[0].source, "/:path*");
  const headers = Object.fromEntries(rules[0].headers.map(({ key, value }) => [key, value]));
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["X-Frame-Options"], "DENY");
  assert.equal(headers["Referrer-Policy"], "same-origin");
  assert.equal(headers["Permissions-Policy"], "camera=(), microphone=(self)");
  assert.equal(headers["Content-Security-Policy"], "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'");
});

test("HSTS applies only to an explicitly HTTPS deployment origin", async () => {
  const previous = process.env.MING_APP_ORIGIN;
  try {
    for (const origin of [undefined, "http://localhost:3000", "https://ming.example"]) {
      if (origin === undefined) delete process.env.MING_APP_ORIGIN;
      else process.env.MING_APP_ORIGIN = origin;
      const rules = await config.headers();
      const hsts = rules[0].headers.find(({ key }) => key === "Strict-Transport-Security");
      assert.equal(hsts?.value, origin?.startsWith("https://") ? "max-age=31536000" : undefined);
    }
  } finally {
    if (previous === undefined) delete process.env.MING_APP_ORIGIN;
    else process.env.MING_APP_ORIGIN = previous;
  }
});
