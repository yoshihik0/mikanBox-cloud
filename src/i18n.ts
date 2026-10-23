import JA from '../lang/ja.json';
import EN from '../lang/en.json';

export function getSystemLanguage(settings: { system_lang?: string }, acceptLanguage = ''): string {
  if (settings.system_lang === 'ja' || settings.system_lang === 'en') return settings.system_lang;
  return acceptLanguage.toLowerCase().startsWith('en') ? 'en' : 'ja';
}
export function createTranslator(lang: string) {
  const dict: Record<string, string> = lang === 'en' ? EN : JA;
  return (key: string, ...args: (string | number)[]) => {
    let index = 0;
    return (dict[key] ?? key).replace(/%[sd]/g, () => String(args[index++] ?? ''));
  };
}
