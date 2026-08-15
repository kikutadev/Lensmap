import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { applyDocumentLocale, resolvedLocale, setLocalePreference, t, type MessageKey, type MessageSubstitutions, type SupportedLocale } from "./runtime";
import { loadLocalePreference, saveLocalePreference, subscribeLocalePreference, type LocalePreference } from "./settings";

interface I18nContextValue {
  preference: LocalePreference;
  locale: SupportedLocale;
  ready: boolean;
  translate: (key: MessageKey, substitutions?: MessageSubstitutions) => string;
  setPreference: (preference: LocalePreference) => Promise<void>;
}

const I18nContext = createContext<I18nContextValue | null>(null);

/** Keep React extension surfaces synchronized with the shared Lensmap locale preference. */
export function I18nProvider({ children }: PropsWithChildren) {
  const [preference, setPreferenceState] = useState<LocalePreference>("system");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | null = null;

    void loadLocalePreference().then((initial) => {
      if (disposed) return;
      setLocalePreference(initial);
      applyDocumentLocale(document);
      setPreferenceState(initial);
      setReady(true);
      unsubscribe = subscribeLocalePreference((next) => {
        setLocalePreference(next);
        applyDocumentLocale(document);
        setPreferenceState(next);
      });
    });

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

  const setPreference = useCallback(async (next: LocalePreference) => {
    setLocalePreference(next);
    applyDocumentLocale(document);
    setPreferenceState(next);
    await saveLocalePreference(next);
  }, []);

  // The callback depends on preference deliberately so consumers re-render and re-run t() after locale changes.
  const translate = useCallback((key: MessageKey, substitutions?: MessageSubstitutions) => t(key, substitutions), [preference]);
  const value = useMemo<I18nContextValue>(() => ({
    preference,
    locale: resolvedLocale(preference),
    ready,
    translate,
    setPreference,
  }), [preference, ready, setPreference, translate]);

  // Do not mount queries or user-visible controls using the wrong locale while an explicit override is loading.
  return <I18nContext.Provider value={value}>{ready ? children : null}</I18nContext.Provider>;
}

/** Access the current Lensmap display locale and type-safe translation function. */
export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}
