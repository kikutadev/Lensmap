import { beforeEach, describe, expect, it } from "vitest";
import { emptyTabState } from "../../lib/state";
import { useSidePanelStore } from "./store";

beforeEach(() => {
  useSidePanelStore.setState({
    activeTabId: null,
    tabState: null,
    lastAssistant: null,
    transientByTab: {},
    view: "chat",
  });
});

describe("side panel transient state", () => {
  it("keeps streaming and composer state isolated by tab", () => {
    const store = useSidePanelStore.getState();
    store.setTabState({ ...emptyTabState(1), pdfUrl: "https://example.com/a.pdf", status: "ready" });
    store.setStreamState(1, "streaming", "answer A");
    store.setComposerDraft(1, "question A");

    store.setTabState({ ...emptyTabState(2), pdfUrl: "https://example.com/b.pdf", status: "ready" });
    store.setStreamState(2, "streaming", "answer B");
    store.setComposerDraft(2, "question B");

    const state = useSidePanelStore.getState();
    expect(state.transientByTab["1"]?.streamingContent).toBe("answer A");
    expect(state.transientByTab["1"]?.composerDraft).toBe("question A");
    expect(state.transientByTab["2"]?.streamingContent).toBe("answer B");
    expect(state.transientByTab["2"]?.composerDraft).toBe("question B");
  });

  it("resets transient UI when the document changes inside the same tab", () => {
    const store = useSidePanelStore.getState();
    store.setTabState({ ...emptyTabState(3), pdfUrl: "https://example.com/a.pdf", status: "ready" });
    store.setStreamState(3, "error", "old error");
    store.setComposerDraft(3, "old draft");
    store.setSelectedInsightId(3, "insight-a");
    store.setActionError(3, "old action error");

    useSidePanelStore.getState().setTabState({ ...emptyTabState(3), pdfUrl: "https://example.com/b.pdf", status: "importing" });

    const transient = useSidePanelStore.getState().transientByTab["3"];
    expect(transient).toMatchObject({
      documentKey: "https://example.com/b.pdf",
      streamStatus: "idle",
      streamingContent: "",
      composerDraft: "",
      selectedInsightId: null,
      actionError: null,
    });
  });
});
