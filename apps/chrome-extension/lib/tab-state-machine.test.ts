import { describe, expect, it } from "vitest";
import {
  canonicalDocumentUrl,
  createCaptureStartState,
  emptyTabState,
  shouldResetForNavigation,
} from "./tab-state-machine";

function sourceStub(id: string) {
  return {
    id,
    bookId: "book-a",
    pageStart: 0,
    pageEnd: 0,
    quoteRaw: "example",
    quoteNormalized: "example",
    rects: [],
    textHash: `hash-${id}`,
    origin: "user-selection" as const,
    documentNodeIds: [],
    createdAt: "2026-08-12T00:00:00.000Z",
  };
}

describe("tab state machine", () => {
  it("preserves book-bound state when capturing another source from the same PDF", () => {
    const previous = {
      ...emptyTabState(7),
      status: "ready" as const,
      pdfUrl: "https://example.com/book.pdf",
      bookId: "book-a",
      sources: [sourceStub("s1")],
      threadId: "thread-a",
      composerFocusRequest: 2,
    };

    const next = createCaptureStartState(previous, {
      pdfUrl: "https://example.com/book.pdf",
      selectionText: "next selection",
      focusComposer: true,
      captureId: "capture-2",
    });

    expect(next.bookId).toBe("book-a");
    expect(next.sources).toHaveLength(1);
    expect(next.threadId).toBe("thread-a");
    expect(next.composerFocusRequest).toBe(3);
    expect(next.captureId).toBe("capture-2");
  });

  it("fully resets sources and chat when the same Chrome tab changes to another PDF", () => {
    const previous = {
      ...emptyTabState(7),
      status: "ready" as const,
      pdfUrl: "https://example.com/a.pdf",
      bookId: "book-a",
      sources: [sourceStub("s1")],
      threadId: "thread-a",
      composerFocusRequest: 4,
    };

    const next = createCaptureStartState(previous, {
      pdfUrl: "https://example.com/b.pdf",
      selectionText: "book B",
      focusComposer: true,
      captureId: "capture-b",
    });

    expect(next.pdfUrl).toBe("https://example.com/b.pdf");
    expect(next.bookId).toBeNull();
    expect(next.sources).toEqual([]);
    expect(next.threadId).toBeNull();
    expect(next.composerFocusRequest).toBe(1);
  });

  it("treats PDF #page navigation as the same document but resets on a different URL", () => {
    const state = { ...emptyTabState(2), pdfUrl: "https://example.com/book.pdf" };
    expect(shouldResetForNavigation(state, "https://example.com/book.pdf#page=8")).toBe(false);
    expect(shouldResetForNavigation(state, "https://example.com/other.pdf")).toBe(true);
    expect(canonicalDocumentUrl("https://example.com/book.pdf#page=8")).toBe("https://example.com/book.pdf");
  });
});
