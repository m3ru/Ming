import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = mkdtempSync(join(tmpdir(), "ming-voice-tests-"));
try {
  for (const file of [
    "tests/live-voice.test.ts",
    "src/lib/liveVoice.ts",
    "src/lib/voiceTranscript.ts",
    "src/lib/server/security.ts",
    "src/backend/src/lib/voice.ts",
    "src/backend/src/lib/prompts.ts",
  ]) {
    const target = join(output, file.replace(/\.ts$/, ".js"));
    mkdirSync(dirname(target), { recursive: true });
    const result = ts.transpileModule(readFileSync(join(root, file), "utf8"), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
      },
    });
    writeFileSync(target, result.outputText);
  }
  const result = spawnSync(
    process.execPath,
    ["--test", join(output, "tests/live-voice.test.js")],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_PATH: [
          join(root, "src/backend/node_modules"),
          join(root, "node_modules"),
        ].join(delimiter),
      },
    },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(output, { recursive: true, force: true });
}
