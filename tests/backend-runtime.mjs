import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../", import.meta.url));
const rootRequire = createRequire(join(root, "package.json"));
export const backendRequire = createRequire(
  join(root, "src/backend/package.json"),
);
const ts = rootRequire("typescript");

// Run the real installed runtime against selected app sources. Every relative
// import must be declared so tests cannot accidentally open a private DB or
// import an agent using actual credentials. No generated build is required.
export function loadBackendSource(relativePath, mocks = {}) {
  const { outputText } = ts.transpileModule(
    readFileSync(join(root, relativePath), "utf8"),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
      },
    },
  );
  const module = { exports: {} };
  new Function("require", "module", "exports", outputText)(
    (id) => {
      if (Object.hasOwn(mocks, id)) return mocks[id];
      if (id.startsWith(".") || id.startsWith("@/")) {
        throw new Error(`Unexpected app import in ${relativePath}: ${id}`);
      }
      return backendRequire(id);
    },
    module,
    module.exports,
  );
  return module.exports;
}
