import { browser } from "wxt/browser";

export type LocalePreference = "system" | "en" | "ja";

export const LOCALE_PREFERENCE_KEY = "lensmap.localePreference";

/** Normalize persisted/foreign values into the stable Lensmap locale preference domain. */
export function normalizeLocalePreference(value: unknown): LocalePreference {
  return value === "en" || value === "ja" || value === "system" ? value : "system";
}

/** Read the persisted Lensmap display-language preference. */
export async function loadLocalePreference(): Promise<LocalePreference> {
  const stored = await browser.storage.local.get(LOCALE_PREFERENCE_KEY) as Record<string, unknown>;
  return normalizeLocalePreference(stored[LOCALE_PREFERENCE_KEY]);
}

/** Persist only the Lensmap display-language preference. */
export async function saveLocalePreference(preference: LocalePreference): Promise<void> {
  await browser.storage.local.set({ [LOCALE_PREFERENCE_KEY]: preference });
}

/** Subscribe to Lensmap display-language changes without coupling callers to storage details. */
export function subscribeLocalePreference(listener: (preference: LocalePreference) => void): () => void {
  const onChanged = (changes: Record<string, Browser.storage.StorageChange>, areaName: string) => {
    if (areaName !== "local" || !(LOCALE_PREFERENCE_KEY in changes)) return;
    listener(normalizeLocalePreference(changes[LOCALE_PREFERENCE_KEY]?.newValue));
  };
  browser.storage.onChanged.addListener(onChanged);
  return () => browser.storage.onChanged.removeListener(onChanged);
}
