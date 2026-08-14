import { browser } from "wxt/browser";
import {
  emptyTabState,
  normalizeTabState,
  type LensmapStorageShape,
  type LensmapTabState,
} from "./tab-state-machine";

export type { CaptureSelectionPayload, LensmapStorageShape, LensmapTabState, ExtensionStatus } from "./tab-state-machine";
export { emptyTabState } from "./tab-state-machine";

const DEFAULT_SERVER_BASE = "http://127.0.0.1:4317/api";
const TAB_STATE_PREFIX = "lensmap.tabState:";
const CAPABILITY_TOKEN_KEY = "lensmap.capabilityToken";
const SERVER_BASE_KEY = "lensmap.serverBase";
const BOOK_URL_CACHE_KEY = "lensmap.bookByPdfUrl";
const ACTIVE_WORKSPACE_KEY = "lensmap.activeWorkspaceId";
const BOOK_LOCATION_PREFIX = "lensmap.bookLocation:";

function tabStateKey(tabId: number): string { return `${TAB_STATE_PREFIX}${tabId}`; }

/** Read capture-only state for one Chrome tab. There is intentionally no pre-release legacy fallback. */
export async function getTabState(tabId: number): Promise<LensmapTabState> {
  const key = tabStateKey(tabId);
  const stored = await browser.storage.local.get(key) as Record<string, unknown>;
  const direct = stored[key] as LensmapTabState | undefined;
  return direct ? normalizeTabState(direct, tabId) : emptyTabState(tabId);
}

export async function setTabState(tabId: number, state: LensmapTabState): Promise<LensmapTabState> {
  const normalized = normalizeTabState(state, tabId);
  await browser.storage.local.set({ [tabStateKey(tabId)]: normalized });
  return normalized;
}

export async function patchTabState(tabId: number, patch: Partial<LensmapTabState>): Promise<LensmapTabState> {
  const current = await getTabState(tabId);
  return setTabState(tabId, { ...current, ...patch, tabId });
}

export async function patchTabStateForCapture(tabId: number, captureId: string, patch: Partial<LensmapTabState>): Promise<LensmapTabState | null> {
  const current = await getTabState(tabId);
  if (current.captureId !== captureId) return null;
  return setTabState(tabId, { ...current, ...patch, tabId });
}

/** Clear only document/capture state. Reader Workspace selection and Explore state remain intact. */
export async function resetTabState(tabId: number): Promise<LensmapTabState> {
  const next = emptyTabState(tabId);
  await browser.storage.local.set({ [tabStateKey(tabId)]: next });
  return next;
}

export async function removeTabState(tabId: number): Promise<void> {
  await browser.storage.local.remove(tabStateKey(tabId));
}

/** Keep the loopback capability session-only so it is never persisted to disk by Lensmap. */
export async function getCapabilityToken(): Promise<string | null> {
  const stored = await browser.storage.session.get(CAPABILITY_TOKEN_KEY) as Record<string, unknown>;
  const token = stored[CAPABILITY_TOKEN_KEY];
  return typeof token === "string" && token.length >= 32 ? token : null;
}

export async function setCapabilityToken(token: string): Promise<void> {
  if (token.length < 32 || /\s/u.test(token)) throw new Error("Invalid Lensmap capability token");
  await browser.storage.session.set({ [CAPABILITY_TOKEN_KEY]: token });
}

export async function clearCapabilityToken(): Promise<void> {
  await browser.storage.session.remove(CAPABILITY_TOKEN_KEY);
}

export async function getServerBase(): Promise<string> {
  const stored = await browser.storage.local.get(SERVER_BASE_KEY) as LensmapStorageShape;
  return stored[SERVER_BASE_KEY]?.trim() || DEFAULT_SERVER_BASE;
}

export async function getBookUrlCache(): Promise<Record<string, string>> {
  const stored = await browser.storage.local.get(BOOK_URL_CACHE_KEY) as LensmapStorageShape;
  return stored[BOOK_URL_CACHE_KEY] ?? {};
}

export async function setBookUrlCache(cache: Record<string, string>): Promise<void> {
  await browser.storage.local.set({ [BOOK_URL_CACHE_KEY]: cache });
}

export async function getActiveWorkspaceId(): Promise<string | null> {
  const stored = await browser.storage.local.get(ACTIVE_WORKSPACE_KEY) as LensmapStorageShape;
  const value = stored[ACTIVE_WORKSPACE_KEY];
  return typeof value === "string" && value ? value : null;
}

export async function setActiveWorkspaceId(workspaceId: string): Promise<void> {
  if (!workspaceId.trim()) throw new Error("Workspace ID is required");
  await browser.storage.local.set({ [ACTIVE_WORKSPACE_KEY]: workspaceId });
}

export async function clearActiveWorkspaceId(): Promise<void> {
  await browser.storage.local.remove(ACTIVE_WORKSPACE_KEY);
}

export interface BookTabLocation { tabId: number; pdfUrl: string; }

export async function setBookTabLocation(bookId: string, location: BookTabLocation): Promise<void> {
  await browser.storage.local.set({ [`${BOOK_LOCATION_PREFIX}${bookId}`]: location });
}

export async function getBookTabLocation(bookId: string): Promise<BookTabLocation | null> {
  const key = `${BOOK_LOCATION_PREFIX}${bookId}`;
  const stored = await browser.storage.local.get(key) as Record<string, unknown>;
  const value = stored[key];
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<BookTabLocation>;
  return Number.isInteger(candidate.tabId) && typeof candidate.pdfUrl === "string"
    ? { tabId: candidate.tabId!, pdfUrl: candidate.pdfUrl }
    : null;
}

export function isLensmapStorageChange(changes: Record<string, Browser.storage.StorageChange>): boolean {
  return Object.keys(changes).some((key) => key.startsWith("lensmap."));
}
