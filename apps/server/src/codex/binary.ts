import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

/** Resolve Codex CLI, preferring explicit configuration and the app-server-capable ChatGPT bundle before PATH shims. */
export function resolveCodexBinary(explicitPath: string | null): string | null {
  const candidates = [
    explicitPath,
    "/Applications/ChatGPT.app/Contents/Resources/codex",
    join(homedir(), "Applications/ChatGPT.app/Contents/Resources/codex"),
    ...pathCandidates(process.env.PATH),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue searching; absence is surfaced as a normal unavailable state to the UI.
    }
  }
  return null;
}

function pathCandidates(pathValue: string | undefined): string[] {
  if (!pathValue) return [];
  return pathValue
    .split(delimiter)
    .filter(Boolean)
    .map((directory) => join(directory, "codex"));
}
