import { accessSync, constants } from "node:fs";
import { spawn } from "node:child_process";

export interface VisualOcrResult {
  text: string;
  confidence: number;
}

export interface VisualOcrService {
  recognize(png: Buffer): Promise<VisualOcrResult | null>;
}

/** Invoke the bundled macOS Vision helper without persisting the crop to a temporary OCR file. */
export class MacVisionOcrService implements VisualOcrService {
  public constructor(private readonly binaryPath: string | null, private readonly timeoutMs = 20_000) {}

  public async recognize(png: Buffer): Promise<VisualOcrResult | null> {
    if (!this.binaryPath || !isExecutable(this.binaryPath)) return null;
    return new Promise<VisualOcrResult | null>((resolve, reject) => {
      const child = spawn(this.binaryPath!, [], { stdio: ["pipe", "pipe", "pipe"] });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        callback();
      };
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        finish(() => reject(new Error("Visual OCR timed out")));
      }, this.timeoutMs);
      child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      child.once("error", (error) => finish(() => reject(error)));
      child.once("exit", (code) => finish(() => {
        if (code !== 0) {
          reject(new Error(Buffer.concat(stderr).toString("utf8").trim() || `Visual OCR exited with code ${String(code)}`));
          return;
        }
        try {
          const parsed = JSON.parse(Buffer.concat(stdout).toString("utf8")) as { text?: unknown; confidence?: unknown };
          const text = typeof parsed.text === "string" ? parsed.text.trim() : "";
          const confidence = typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)
            ? Math.min(1, Math.max(0, parsed.confidence))
            : 0;
          resolve(text ? { text, confidence } : null);
        } catch (error: unknown) {
          reject(error instanceof Error ? error : new Error("Visual OCR returned invalid JSON"));
        }
      }));
      child.stdin.end(png);
    });
  }
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
