import { applyDocumentLocale, setLocalePreference, t, type MessageKey } from "./runtime";
import { loadLocalePreference, subscribeLocalePreference } from "./settings";

export type PageLocalizationOptions = Readonly<{
  onLocaleChanged?: () => void;
}>;

/** Initialize and keep a non-React extension page synchronized with the Lensmap locale preference. */
export async function installPageLocalization(
  doc: Document,
  options: PageLocalizationOptions = {},
): Promise<() => void> {
  const preference = await loadLocalePreference();
  setLocalePreference(preference);
  localizeDocument(doc);
  options.onLocaleChanged?.();

  return subscribeLocalePreference((next) => {
    setLocalePreference(next);
    localizeDocument(doc);
    options.onLocaleChanged?.();
  });
}

/** Localize text and common accessibility attributes declared through data-i18n markers. */
export function localizeDocument(doc: Document): void {
  applyDocumentLocale(doc);

  for (const element of doc.querySelectorAll<HTMLElement>("[data-i18n]")) {
    const key = readMessageKey(element.dataset.i18n);
    if (key) element.textContent = t(key);
  }
  for (const element of doc.querySelectorAll<HTMLElement>("[data-i18n-placeholder]")) {
    const key = readMessageKey(element.dataset.i18nPlaceholder);
    if (key && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) element.placeholder = t(key);
  }
  for (const element of doc.querySelectorAll<HTMLElement>("[data-i18n-aria-label]")) {
    const key = readMessageKey(element.dataset.i18nAriaLabel);
    if (key) element.setAttribute("aria-label", t(key));
  }
  for (const element of doc.querySelectorAll<HTMLElement>("[data-i18n-title-attr]")) {
    const key = readMessageKey(element.dataset.i18nTitleAttr);
    if (key) element.setAttribute("title", t(key));
  }
  for (const element of doc.querySelectorAll<HTMLElement>("[data-i18n-alt]")) {
    const key = readMessageKey(element.dataset.i18nAlt);
    if (key && element instanceof HTMLImageElement) element.alt = t(key);
  }

  const titleKey = readMessageKey(doc.documentElement.dataset.i18nDocumentTitle);
  if (titleKey) doc.title = t(titleKey);
}

function readMessageKey(value: string | undefined): MessageKey | undefined {
  return value ? value as MessageKey : undefined;
}
