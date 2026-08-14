import process from "node:process";
import { existsSync, readFileSync, readdirSync, rmSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const candidates = [
  process.env.CODEX_BIN,
  ...(process.env.PATH ?? "").split(delimiter).filter(Boolean).map((dir) => join(dir, "codex")),
  "/Applications/ChatGPT.app/Contents/Resources/codex",
  join(homedir(), "Applications/ChatGPT.app/Contents/Resources/codex"),
].filter(Boolean);
const codex = candidates.find((candidate) => existsSync(candidate));
if (!codex) {
  process.stderr.write("Codex CLI was not found. Set CODEX_BIN before generating protocol types.\n");
  process.exit(1);
}

const out = resolve("apps/server/src/codex/generated");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const result = spawnSync(codex, ["app-server", "generate-ts", "--out", out, "--experimental"], {
  stdio: "inherit",
});
if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);

// Codex generates extensionless relative imports. The server uses NodeNext ESM, so generated
// source must reference the emitted .js paths explicitly. Resolve files/directories from the
// generated tree rather than applying a blind textual suffix, which also handles `./v2` -> `./v2/index.js`.
for (const file of walkTypescriptFiles(out)) {
  const original = readFileSync(file, "utf8");
  const rewritten = original.replace(
    /(\bfrom\s+|\bimport\s*\(\s*|\bexport\s+\*\s+from\s+)(["'])(\.\.?\/[^"']+)\2/g,
    (match, prefix, quote, specifier) => `${prefix}${quote}${toRuntimeSpecifier(file, specifier)}${quote}`,
  );
  if (rewritten !== original) writeFileSync(file, rewritten, "utf8");
}

function walkTypescriptFiles(root) {
  const result = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) result.push(...walkTypescriptFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".ts")) result.push(full);
  }
  return result;
}

function toRuntimeSpecifier(importerFile, specifier) {
  if (/\.[cm]?[jt]sx?$/i.test(specifier) || specifier.endsWith(".json")) return specifier;
  const base = resolve(dirname(importerFile), specifier);
  if (existsSync(`${base}.ts`)) return `${specifier}.js`;
  if (existsSync(base) && statSync(base).isDirectory() && existsSync(join(base, "index.ts"))) {
    return `${specifier.replace(/\/$/, "")}/index.js`;
  }
  return specifier;
}
