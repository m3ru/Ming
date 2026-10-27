import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
// `start` runs the production builds; run `npm run build` first.
const start = process.argv[2] === "start";
const require = createRequire(import.meta.url);
const concurrentPackage = require.resolve("concurrently/package.json");
const concurrentCli = join(dirname(concurrentPackage), require(concurrentPackage).bin.concurrently);
const token = process.env.MING_BACKEND_TOKEN || randomBytes(32).toString("hex");
if (token.length < 32 || token.trim() !== token) {
  console.error("MING_BACKEND_TOKEN must contain at least 32 characters, or leave it blank to generate one automatically.");
  process.exit(1);
}

// Mastra's --env parser overwrites inherited values, including blank values.
// Root dotenv-cli already loaded every setting. A comment-only override file
// preserves that environment through Mastra's startup and hot reloads.
const temporaryDirectory = mkdtempSync(join(tmpdir(), "ming-dev-"));
const inheritedEnvFile = join(temporaryDirectory, "inherited.env");
writeFileSync(inheritedEnvFile, "# Settings are inherited from the root development launcher.\n", { mode: 0o600 });
const shellQuote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
const child = spawn(process.execPath, [
  concurrentCli,
  "--kill-others",
  "-n", "NEXT,MASTRA",
  "-c", "blue.bold,magenta.bold",
  start ? "npm run start:next" : "npm run dev:next",
  start ? "npm run start:mastra" : "npm run dev:mastra -- --env " + shellQuote(inheritedEnvFile),
], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    MING_BACKEND_TOKEN: token,
    // The built backend is a production bundle, which requires MING_DATABASE_URL.
    // Locally it defaults to the development database file in src/backend.
    ...(start && !process.env.MING_DATABASE_URL?.trim() && { MING_DATABASE_URL: "file:./storage.db" }),
  },
});

const cleanup = () => rmSync(temporaryDirectory, { recursive: true, force: true });
process.once("exit", cleanup);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => child.kill(signal));
}
child.once("error", (error) => {
  console.error("Could not start the development servers:", error.message);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1);
});
