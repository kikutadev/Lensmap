export interface ContextMenuActionRun<T> {
  panelPromise: Promise<void>;
  capturePromise: Promise<T>;
}

/**
 * Start the user-gesture-sensitive side-panel open before any long-running capture work.
 * The two promises stay independent so a panel-open failure never rewrites capture success as an error.
 */
export function startContextMenuAction<T>(input: {
  openPanel?: () => Promise<void>;
  capture: () => Promise<T>;
}): ContextMenuActionRun<T> {
  let panelPromise: Promise<void>;
  try {
    panelPromise = input.openPanel ? input.openPanel() : Promise.resolve();
  } catch (error) {
    panelPromise = Promise.reject(error);
  }

  let capturePromise: Promise<T>;
  try {
    capturePromise = input.capture();
  } catch (error) {
    capturePromise = Promise.reject(error);
  }

  return { panelPromise, capturePromise };
}
