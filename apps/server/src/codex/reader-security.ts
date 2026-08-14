const DISABLED_APP_SERVER_FEATURES = [
  "apps",
  "browser_use",
  "browser_use_external",
  "browser_use_full_cdp_access",
  "computer_use",
  "in_app_browser",
  "plugins",
  "remote_plugin",
  "image_generation",
  "shell_tool",
  "unified_exec",
  "shell_snapshot",
  "multi_agent",
  "skill_search",
  "tool_suggest",
  "hooks",
  "workspace_dependencies",
  "memories",
  "goals",
] as const;

/**
 * Start app-server with non-reading tool families disabled at the process level.
 * `code_mode_host` intentionally remains enabled because current Codex dynamic tools require it.
 */
export function buildReaderAppServerArgs(): string[] {
  return [
    "app-server",
    "--stdio",
    ...DISABLED_APP_SERVER_FEATURES.flatMap((feature) => ["--disable", feature]),
  ];
}

/** Extract configured MCP names without copying commands, env variables, or credentials into app state. */
export function extractConfiguredMcpServerNames(config: unknown): string[] {
  if (!isRecord(config)) return [];
  const servers = config.mcp_servers;
  if (!isRecord(servers)) return [];
  return Object.keys(servers).sort();
}

/**
 * Per-thread defense in depth. All configured MCP servers, Codex apps, and web search are disabled,
 * and the only model-side retrieval path left to Deep Reader is its explicit dynamic `book_*` tool set.
 */
export function buildReaderThreadConfig(configuredMcpServerNames: string[]): Record<string, unknown> {
  return {
    web_search: "disabled",
    apps: {
      _default: {
        enabled: false,
      },
    },
    mcp_servers: Object.fromEntries(
      configuredMcpServerNames.map((name) => [name, { enabled: false }]),
    ),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
