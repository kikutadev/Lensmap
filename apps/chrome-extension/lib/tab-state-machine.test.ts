import { describe, expect, it } from "vitest";
import { canonicalDocumentUrl, createCaptureStartState, emptyTabState, shouldResetForNavigation } from "./tab-state-machine";

describe("capture-only tab state machine", () => {
  it("preserves same-PDF capture metadata without owning Workspace Explore state", () => {
    const previous = {
      ...emptyTabState(7),
      status: "ready" as const,
      pdfUrl: "https://example.com/book.pdf",
      bookId: "book-a",
      workspaceId: "workspace-a",
      composerFocusRequest: 2,
    };
    const next = createCaptureStartState(previous, {
      pdfUrl: "https://example.com/book.pdf",
      selectionText: "next selection",
      focusComposer: true,
      captureId: "capture-2",
    });
    expect(next.bookId).toBe("book-a");
    expect(next.workspaceId).toBe("workspace-a");
    expect(next.composerFocusRequest).toBe(3);
    expect(next.captureId).toBe("capture-2");
    expect("sources" in next).toBe(false);
    expect("threadId" in next).toBe(false);
  });

  it("resets only capture metadata when the same Chrome tab changes to another PDF", () => {
    const previous = {
      ...emptyTabState(7),
      status: "ready" as const,
      pdfUrl: "https://example.com/a.pdf",
      bookId: "book-a",
      workspaceId: "workspace-a",
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
    expect(next.workspaceId).toBeNull();
    expect(next.composerFocusRequest).toBe(1);
  });

  it("treats PDF #page navigation as the same document but resets on a different URL", () => {
    const state = { ...emptyTabState(2), pdfUrl: "https://example.com/book.pdf" };
    expect(shouldResetForNavigation(state, "https://example.com/book.pdf#page=8")).toBe(false);
    expect(shouldResetForNavigation(state, "https://example.com/other.pdf")).toBe(true);
    expect(canonicalDocumentUrl("https://example.com/book.pdf#page=8")).toBe("https://example.com/book.pdf");
  });
});
