import type { ChatMessage } from "@deep-reader/shared";
import { browser } from "wxt/browser";
import {
  emptyTabState,
  normalizeTabState,
  type DeepReaderStorageShape,
  type DeepReaderTabState,
} from "./tab-state-machine";

export type { CaptureSelectionPayload, DeepReaderStorageShape, DeepReaderTabState, ExtensionStatus } from "./tab-state-machine";
export { emptyTabState } from "./tab-state-machine";

const DEFAULT_SERVER_BASE = "http://127.0.0.1:4317/api";
const LEGACY_TAB_STATES_KEY = "deepReaderTabStates";
const LEGACY_LAST_ASSISTANT_KEY = "lastAssistantByTab";
const TAB_STATE_PREFIX = "deepReaderTabState:";
const LAST_ASSISTANT_PREFIX = "deepReaderLastAssistant:";
const CAPABILITY_TOKEN_KEY = "deepReaderCapabilityToken";

function tabStateKey(tabId: number): string {
  return `${TAB_STATE_PREFIX}${tabId}`;
}

function lastAssistantKey(tabId: number): string {
  return `${LAST_ASSISTANT_PREFIX}${tabId}`;
}

/** Read a tab state from the race-resistant per-tab key, with transparent migration from the legacy map. */
export async function getTabState(tabId: number): Promise<DeepReaderTabState> {
  const key = tabStateKey(tabId);
  const stored = await browser.storage.local.get([key, LEGACY_TAB_STATES_KEY]) as Record<string, unknown>;
  const direct = stored[key] as DeepReaderTabState | undefined;
  if (direct) return normalizeTabState(direct, tabId);

  const legacyMap = stored[LEGACY_TAB_STATES_KEY] as DeepReaderStorageShape["deepReaderTabStates"] | undefined;
  const legacy = legacyMap?.[String(tabId)];
  if (!legacy) return emptyTabState(tabId);

  const migrated = normalizeTabState(legacy, tabId);
  await browser.storage.local.set({ [key]: migrated });
  await removeLegacyMapEntry(LEGACY_TAB_STATES_KEY, tabId);
  return migrated;
}

/** Persist one tab independently so concurrent writes from other tabs cannot overwrite it. */
export async function setTabState(tabId: number, state: DeepReaderTabState): Promise<DeepReaderTabState> {
  const normalized = normalizeTabState(state, tabId);
  await browser.storage.local.set({ [tabStateKey(tabId)]: normalized });
  return normalized;
}

export async function patchTabState(tabId: number, patch: Partial<DeepReaderTabState>): Promise<DeepReaderTabState> {
  const current = await getTabState(tabId);
  return setTabState(tabId, { ...current, ...patch, tabId });
}

/** Apply a capture result only if the same capture operation is still current for the tab. */
export async function patchTabStateForCapture(
  tabId: number,
  captureId: string,
  patch: Partial<DeepReaderTabState>,
): Promise<DeepReaderTabState | null> {
  const current = await getTabState(tabId);
  if (current.captureId !== captureId) return null;
  return setTabState(tabId, { ...current, ...patch, tabId });
}

/** Clear document-bound state after same-tab navigation while invalidating any stale capture result. */
export async function resetTabState(tabId: number): Promise<DeepReaderTabState> {
  const next = emptyTabState(tabId);
  await Promise.all([
    browser.storage.local.set({ [tabStateKey(tabId)]: next }),
    clearLastAssistant(tabId),
  ]);
  return next;
}

export async function removeTabState(tabId: number): Promise<void> {
  await browser.storage.local.remove([tabStateKey(tabId), lastAssistantKey(tabId)]);
  await Promise.all([
    removeLegacyMapEntry(LEGACY_TAB_STATES_KEY, tabId),
    removeLegacyMapEntry(LEGACY_LAST_ASSISTANT_KEY, tabId),
  ]);
}

export async function setLastAssistant(tabId: number, message: ChatMessage): Promise<void> {
  await browser.storage.local.set({ [lastAssistantKey(tabId)]: message });
}

export async function getLastAssistant(tabId: number): Promise<ChatMessage | null> {
  const key = lastAssistantKey(tabId);
  const stored = await browser.storage.local.get([key, LEGACY_LAST_ASSISTANT_KEY]) as Record<string, unknown>;
  const direct = stored[key] as ChatMessage | undefined;
  if (direct) return direct;

  const legacyMap = stored[LEGACY_LAST_ASSISTANT_KEY] as DeepReaderStorageShape["lastAssistantByTab"] | undefined;
  const legacy = legacyMap?.[String(tabId)] ?? null;
  if (legacy) {
    await browser.storage.local.set({ [key]: legacy });
    await removeLegacyMapEntry(LEGACY_LAST_ASSISTANT_KEY, tabId);
  }
  return legacy;
}

export async function clearLastAssistant(tabId: number): Promise<void> {
  await browser.storage.local.remove(lastAssistantKey(tabId));
  await removeLegacyMapEntry(LEGACY_LAST_ASSISTANT_KEY, tabId);
}


/** Keep the loopback capability in session-only extension storage so it is never persisted to disk by Deep Reader. */
export async function getCapabilityToken(): Promise<string | null> {
  const stored = await browser.storage.session.get(CAPABILITY_TOKEN_KEY) as Record<string, unknown>;
  const token = stored[CAPABILITY_TOKEN_KEY];
  return typeof token === "string" && token.length >= 32 ? token : null;
}

export async function setCapabilityToken(token: string): Promise<void> {
  if (token.length < 32 || /\s/u.test(token)) throw new Error("Invalid Deep Reader capability token");
  await browser.storage.session.set({ [CAPABILITY_TOKEN_KEY]: token });
}

export async function clearCapabilityToken(): Promise<void> {
  await browser.storage.session.remove(CAPABILITY_TOKEN_KEY);
}

export async function getServerBase(): Promise<string> {
  const stored = await browser.storage.local.get("deepReaderServerBase") as DeepReaderStorageShape;
  return stored.deepReaderServerBase?.trim() || DEFAULT_SERVER_BASE;
}

export async function getBookUrlCache(): Promise<Record<string, string>> {
  const stored = await browser.storage.local.get("bookByPdfUrl") as DeepReaderStorageShape;
  return stored.bookByPdfUrl ?? {};
}

export async function setBookUrlCache(cache: Record<string, string>): Promise<void> {
  await browser.storage.local.set({ bookByPdfUrl: cache });
}

async function removeLegacyMapEntry(storageKey: string, tabId: number): Promise<void> {
  const stored = await browser.storage.local.get(storageKey) as Record<string, unknown>;
  const current = stored[storageKey];
  if (!current || typeof current !== "object") return;
  const map = { ...(current as Record<string, unknown>) };
  const key = String(tabId);
  if (!(key in map)) return;
  delete map[key];
  if (Object.keys(map).length === 0) {
    await browser.storage.local.remove(storageKey);
  } else {
    await browser.storage.local.set({ [storageKey]: map });
  }
}

export function isDeepReaderStorageChange(
  changes: Record<string, Browser.storage.StorageChange>,
): boolean {
  return Object.keys(changes).some((key) =>
    key.startsWith(TAB_STATE_PREFIX)
    || key.startsWith(LAST_ASSISTANT_PREFIX)
    || key === LEGACY_TAB_STATES_KEY
    || key === LEGACY_LAST_ASSISTANT_KEY,
  );
}
