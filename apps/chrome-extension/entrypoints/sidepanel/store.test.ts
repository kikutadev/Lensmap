import { beforeEach, describe, expect, it } from "vitest";
import { emptyWorkspaceTransientState, useSidePanelStore } from "./store";

beforeEach(() => {
  useSidePanelStore.setState({
    activeTabId: null,
    tabState: null,
    activeWorkspaceId: null,
    transientByWorkspace: {},
    view: "explore",
  });
});

describe("side panel Workspace store", () => {
  it("isolates drafts and streaming state by Workspace rather than Chrome tab", () => {
    const store = useSidePanelStore.getState();
    store.setComposerDraft("workspace-a", "question A");
    store.setStreamState("workspace-a", "streaming", "answer A");
    store.setComposerDraft("workspace-b", "question B");
    store.setStreamState("workspace-b", "idle", "");

    const state = useSidePanelStore.getState();
    expect(state.transientByWorkspace["workspace-a"]?.composerDraft).toBe("question A");
    expect(state.transientByWorkspace["workspace-a"]?.streamingContent).toBe("answer A");
    expect(state.transientByWorkspace["workspace-b"]?.composerDraft).toBe("question B");
  });

  it("keeps Workspace transient state while the active Chrome tab changes", () => {
    const store = useSidePanelStore.getState();
    store.setActiveWorkspaceId("workspace-a");
    store.setComposerDraft("workspace-a", "keep me");
    store.setActiveThreadId("workspace-a", "thread-a");
    store.setSelectedMapId("workspace-a", "map-a");
    store.setModelOverride("workspace-a", "gpt-5.6-sol");
    store.setActiveTabId(10);
    store.setActiveTabId(20);

    expect(useSidePanelStore.getState().transientByWorkspace["workspace-a"]).toMatchObject({
      composerDraft: "keep me",
      activeThreadId: "thread-a",
      selectedMapId: "map-a",
      modelOverride: "gpt-5.6-sol",
    });
  });

  it("creates a clean transient state for a newly selected Workspace", () => {
    useSidePanelStore.getState().setActiveWorkspaceId("workspace-new");
    expect(useSidePanelStore.getState().transientByWorkspace["workspace-new"]).toEqual(emptyWorkspaceTransientState());
  });
});
