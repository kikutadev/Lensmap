import { beforeEach, describe, expect, it } from "vitest";
import en from "../../locales/en.json";
import ja from "../../locales/ja.json";
import { normalizeLocalePreference } from "./settings";
import { setLocalePreference, t } from "./runtime";

type CatalogNode = string | CatalogMap;
interface CatalogMap { readonly [key: string]: CatalogNode }

describe("Lensmap i18n catalogs", () => {
  beforeEach(() => setLocalePreference("en"));

  it("keeps English and Japanese leaf-key sets identical", () => {
    expect(flattenKeys(ja)).toEqual(flattenKeys(en));
  });

  it("does not contain empty translation values", () => {
    expect(emptyKeys(en)).toEqual([]);
    expect(emptyKeys(ja)).toEqual([]);
  });

  it("uses only Chrome-compatible message-key path segments", () => {
    const validSegment = /^[A-Za-z0-9_]+$/;
    for (const catalog of [en, ja]) {
      for (const key of flattenKeys(catalog)) {
        for (const segment of key.split(".")) {
          expect(segment, `Invalid Chrome i18n key segment: ${key}`).toMatch(validSegment);
        }
      }
    }
  });

  it("switches Lensmap-owned UI copy between English and Japanese at runtime", () => {
    setLocalePreference("en");
    expect(t("contextMenu.explore")).toBe("Explore with Lensmap");

    setLocalePreference("ja");
    expect(t("contextMenu.explore")).toBe("LensmapでExplore");
  });

  it("supports named substitutions in explicit runtime locales", () => {
    setLocalePreference("en");
    expect(t("sidepanel.showReferences", { count: 3 })).toBe("Show 3 references");

    setLocalePreference("ja");
    expect(t("sidepanel.showReferences", { count: 3 })).toBe("3件の参照を表示");
  });

  it("normalizes unsupported stored locale values to system", () => {
    expect(normalizeLocalePreference("en")).toBe("en");
    expect(normalizeLocalePreference("ja")).toBe("ja");
    expect(normalizeLocalePreference("system")).toBe("system");
    expect(normalizeLocalePreference("fr")).toBe("system");
    expect(normalizeLocalePreference(null)).toBe("system");
  });
});

function flattenKeys(value: CatalogNode, prefix = ""): string[] {
  if (typeof value === "string") return [prefix];
  return Object.entries(value)
    .flatMap(([key, child]) => flattenKeys(child, prefix ? `${prefix}.${key}` : key))
    .sort();
}

function emptyKeys(value: CatalogNode, prefix = ""): string[] {
  if (typeof value === "string") return value.trim() ? [] : [prefix];
  return Object.entries(value)
    .flatMap(([key, child]) => emptyKeys(child, prefix ? `${prefix}.${key}` : key))
    .sort();
}
