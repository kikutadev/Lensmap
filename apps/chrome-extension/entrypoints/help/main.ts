import "./style.css";
import { installPageLocalization } from "../../lib/i18n/page";
import { setLocalePreference } from "../../lib/i18n/runtime";
import { loadLocalePreference, normalizeLocalePreference, saveLocalePreference, type LocalePreference } from "../../lib/i18n/settings";

const languagePreference = requireSelect("language-preference");

void initialize();

async function initialize(): Promise<void> {
  languagePreference.value = await loadLocalePreference();
  await installPageLocalization(document, {
    onLocaleChanged: () => {
      void loadLocalePreference().then((preference) => { languagePreference.value = preference; });
    },
  });

  languagePreference.addEventListener("change", () => {
    void persistLanguagePreference(normalizeLocalePreference(languagePreference.value));
  });
}

/** Persist only the language preference; other Lensmap state is intentionally untouched. */
async function persistLanguagePreference(preference: LocalePreference): Promise<void> {
  setLocalePreference(preference);
  languagePreference.value = preference;
  await saveLocalePreference(preference);
}

function requireSelect(id: string): HTMLSelectElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLSelectElement)) throw new Error(`Missing select: ${id}`);
  return element;
}
