import JA from '../lang/ja.json';
import EN from '../lang/en.json';
// Cloud-only messages (not in the shared PHP translations, which shared/sync-cloud.sh overwrites).
import CLOUD_JA from '../lang/cloud-ja.json';
import CLOUD_EN from '../lang/cloud-en.json';

const DICTS: Record<string, Record<string, string>> = { ja: { ...CLOUD_JA, ...JA }, en: { ...CLOUD_EN, ...EN } };

export function getSystemLanguage(settings: { system_lang?: string }, acceptLanguage = ''): string {
  if (settings.system_lang === 'ja' || settings.system_lang === 'en') return settings.system_lang;
  return acceptLanguage.toLowerCase().startsWith('en') ? 'en' : 'ja';
}
export function createTranslator(lang: string) {
  const dict = DICTS[lang === 'en' ? 'en' : 'ja'];
  return (key: string, ...args: (string | number)[]) => {
    let index = 0;
    return (dict[key] ?? key).replace(/%[sd]/g, () => String(args[index++] ?? ''));
  };
}
