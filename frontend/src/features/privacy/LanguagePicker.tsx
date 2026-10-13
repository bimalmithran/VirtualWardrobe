import { Chips } from '../../components/Chips';
import { LANGUAGES, useI18n } from '../../i18n/I18nProvider';

export function LanguagePicker() {
  const { language, setLanguage } = useI18n();
  return <Chips options={LANGUAGES.map((l) => ({ key: l.code, label: l.native }))} selected={language} onSelect={setLanguage} />;
}
