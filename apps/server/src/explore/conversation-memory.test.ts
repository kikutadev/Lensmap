import { describe, expect, it } from "vitest";
import type { ExploreMessageRecord } from "./explore-repository.js";
import { buildConversationMemory } from "./conversation-memory.js";

function message(index: number): ExploreMessageRecord {
  const timestamp = new Date(2026, 0, 1, 0, index).toISOString();
  return {
    id: `m-${index}`, threadId: "thread-1", role: index % 2 === 0 ? "user" : "assistant",
    content: `message ${index} ${"x".repeat(90)}`, status: "completed", codexTurnId: null,
    createdAt: timestamp, updatedAt: timestamp,
  };
}

describe("buildConversationMemory", () => {
  it("summarizes only older completed messages and remains bounded", () => {
    const memory = buildConversationMemory(Array.from({ length: 20 }, (_, index) => message(index)));
    expect(memory).toContain("message 0");
    expect(memory).not.toContain("message 19");
    expect(memory.length).toBeLessThanOrEqual(6000);
  });
});
