import { describe, expect, it } from "vitest";
import {
  buildReaderAppServerArgs,
  buildReaderThreadConfig,
  extractConfiguredMcpServerNames,
} from "./reader-security.js";

describe("reader security", () => {
  it("disables non-reading app-server feature families while preserving dynamic-tool infrastructure", () => {
    const args = buildReaderAppServerArgs();
    expect(args.slice(0, 2)).toEqual(["app-server", "--stdio"]);
    expect(args).toContain("apps");
    expect(args).toContain("shell_tool");
    expect(args).toContain("unified_exec");
    expect(args).toContain("browser_use");
    expect(args).not.toContain("code_mode_host");
  });

  it("discovers configured MCP names without retaining their config values", () => {
    expect(extractConfiguredMcpServerNames({
      mcp_servers: {
        alpha: { command: "/secret/path", env: { TOKEN: "secret" } },
        beta: { url: "https://example.invalid" },
      },
    })).toEqual(["alpha", "beta"]);
  });

  it("disables every discovered MCP plus app/web retrieval at thread scope", () => {
    expect(buildReaderThreadConfig(["alpha", "beta"])).toEqual({
      web_search: "disabled",
      apps: { _default: { enabled: false } },
      mcp_servers: {
        alpha: { enabled: false },
        beta: { enabled: false },
      },
    });
  });
});
