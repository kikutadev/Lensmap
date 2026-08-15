import { createI18n } from "@wxt-dev/i18n";
import { browser } from "wxt/browser";
import en from "../../locales/en.json";
import ja from "../../locales/ja.json";
import type { LocalePreference } from "./settings";

export type SupportedLocale = "en" | "ja";
type Catalog = typeof en;
type CatalogNode = string | { readonly [key: string]: CatalogNode };

export type MessageKey = DotLeafKeys<Catalog>;
export type MessageSubstitutions = Readonly<Record<string, string | number>>;

const catalogs: Readonly<Record<SupportedLocale, Catalog>> = { en, ja };
const systemI18n = createI18n();
let currentPreference: LocalePreference = "system";

/** Update the locale used by subsequent Lensmap translations. */
export function setLocalePreference(preference: LocalePreference): void {
  currentPreference = preference;
}

/** Return the current Lensmap display-locale preference. */
export function getLocalePreference(): LocalePreference {
  return currentPreference;
}

/** Resolve the effective supported locale used for formatting and document language. */
export function resolvedLocale(preference = currentPreference): SupportedLocale {
  if (preference === "en" || preference === "ja") return preference;
  const uiLanguage = safeUiLanguage().toLowerCase();
  return uiLanguage === "ja" || uiLanguage.startsWith("ja-") ? "ja" : "en";
}

/** Translate Lensmap-owned text through WXT/browser i18n or an explicit runtime catalog override. */
export function t(key: MessageKey, substitutions?: MessageSubstitutions): string {
  if (currentPreference === "system") {
    try {
      const translate = systemI18n.t as unknown as (
        messageKey: string,
        namedSubstitutions?: MessageSubstitutions,
      ) => string;
      const translated = substitutions ? translate(key, substitutions) : translate(key);
      if (translated) return translated;
    } catch {
      // browser.i18n is not available in unit tests and other non-extension contexts.
    }
    const fallback = lookup(catalogs[resolvedLocale()], key) ?? lookup(catalogs.en, key);
    return fallback === undefined ? `[${key}]` : applyNamedSubstitutions(fallback, substitutions);
  }

  const template = lookup(catalogs[currentPreference], key) ?? lookup(catalogs.en, key);
  return template === undefined ? `[${key}]` : applyNamedSubstitutions(template, substitutions);
}

/** Format date/time using the effective Lensmap display locale. */
export function dateTimeFormatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(resolvedLocale(), options);
}

/** Apply the effective Lensmap locale to a document. */
export function applyDocumentLocale(doc: Document): void {
  doc.documentElement.lang = resolvedLocale();
}

function safeUiLanguage(): string {
  try {
    return browser.i18n.getUILanguage?.() || "en";
  } catch {
    return "en";
  }
}

function lookup(catalog: Catalog, key: MessageKey): string | undefined {
  let current: CatalogNode = catalog as CatalogNode;
  for (const segment of key.split(".")) {
    if (typeof current === "string") return undefined;
    const next: CatalogNode | undefined = current[segment];
    if (next === undefined) return undefined;
    current = next;
  }
  return typeof current === "string" ? current : undefined;
}

function applyNamedSubstitutions(template: string, substitutions?: MessageSubstitutions): string {
  if (!substitutions) return template;
  return template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (match, name: string) => {
    const value = substitutions[name];
    return value === undefined ? match : String(value);
  });
}

type DotLeafKeys<T> = {
  [K in keyof T & string]: T[K] extends string
    ? K
    : T[K] extends Readonly<Record<string, unknown>>
      ? `${K}.${DotLeafKeys<T[K]>}`
      : never;
}[keyof T & string];
