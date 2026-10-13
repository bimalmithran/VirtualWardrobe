import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getLocales } from 'expo-localization';

import type { KeyValueStore } from '../storage/keyValue';
import { en, type StringKey, type Strings } from './en';
import { hi } from './hi';
import { ml } from './ml';

export type Language = 'en' | 'hi' | 'ml';

/** Each language labelled in its own script, so anyone can find theirs. */
export const LANGUAGES: { code: Language; native: string }[] = [
  { code: 'en', native: 'English' },
  { code: 'hi', native: 'हिन्दी' },
  { code: 'ml', native: 'മലയാളം' },
];

const DICTIONARIES: Record<Language, Strings> = { en, hi, ml };
const KEY = 'ui_language_v1';

export const isLanguage = (s: unknown): s is Language => s === 'en' || s === 'hi' || s === 'ml';

/** Fills {name} placeholders. */
export function translate(lang: Language, key: StringKey, params?: Record<string, string | number>): string {
  let s = DICTIONARIES[lang][key] ?? en[key];
  if (params) for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** The first device language the app supports, else English. */
export function deviceLanguage(): Language {
  for (const locale of getLocales()) if (isLanguage(locale.languageCode)) return locale.languageCode;
  return 'en';
}

interface I18nValue {
  language: Language;
  setLanguage(lang: Language): void;
  t(key: StringKey, params?: Record<string, string | number>): string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ store, children }: { store: KeyValueStore; children: ReactNode }) {
  const [language, setLang] = useState<Language>(deviceLanguage);

  useEffect(() => {
    store
      .get(KEY)
      .then((saved) => isLanguage(saved) && setLang(saved))
      .catch(() => {});
  }, [store]);

  const setLanguage = useCallback(
    (lang: Language) => {
      setLang(lang);
      store.set(KEY, lang).catch(() => {});
    },
    [store],
  );

  const value = useMemo<I18nValue>(
    () => ({ language, setLanguage, t: (key, params) => translate(language, key, params) }),
    [language, setLanguage],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
  return ctx;
}
