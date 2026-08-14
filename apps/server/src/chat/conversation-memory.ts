import type { ChatMessageRecord } from "./chat-repository.js";

const MAX_SUMMARY_CHARACTERS = 6_000;
const RECENT_MESSAGES_TO_EXCLUDE = 6;
const MAX_MESSAGE_EXCERPT = 700;

/**
 * Build a bounded, non-citeable continuity memory from older completed turns.
 * It is deliberately extractive rather than authoritative: PDF SourceAnchors remain the only citation evidence.
 */
export function buildConversationMemory(messages: ChatMessageRecord[]): string {
  const completed = messages.filter((message) => message.status === "completed" && message.content.trim());
  if (completed.length <= RECENT_MESSAGES_TO_EXCLUDE + 4) return "";
  const older = completed.slice(0, -RECENT_MESSAGES_TO_EXCLUDE);
  const lines: string[] = [];
  let used = 0;
  for (const message of older) {
    const label = message.role === "user" ? "User" : "Assistant";
    const compact = message.content.replace(/\s+/gu, " ").trim();
    const excerpt = compact.length > MAX_MESSAGE_EXCERPT
      ? `${compact.slice(0, MAX_MESSAGE_EXCERPT - 1)}…`
      : compact;
    const line = `${label}: ${excerpt}`;
    if (used + line.length + 1 > MAX_SUMMARY_CHARACTERS) break;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join("\n");
}
