import { describe, expect, it } from "vitest";
import { startContextMenuAction } from "./context-menu-flow";

describe("context menu flow", () => {
  it("invokes sidePanel.open synchronously before capture work starts", async () => {
    const calls: string[] = [];
    const run = startContextMenuAction({
      openPanel: async () => { calls.push("open-panel"); },
      capture: async () => { calls.push("capture"); return "done"; },
    });

    expect(calls).toEqual(["open-panel", "capture"]);
    await expect(run.panelPromise).resolves.toBeUndefined();
    await expect(run.capturePromise).resolves.toBe("done");
  });

  it("keeps capture independent when panel opening fails", async () => {
    let captureRan = false;
    const run = startContextMenuAction({
      openPanel: async () => { throw new Error("panel denied"); },
      capture: async () => { captureRan = true; return 42; },
    });

    await expect(run.panelPromise).rejects.toThrow("panel denied");
    await expect(run.capturePromise).resolves.toBe(42);
    expect(captureRan).toBe(true);
  });
});
