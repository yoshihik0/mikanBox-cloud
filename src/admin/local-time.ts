// The Worker runs in UTC, so a time formatted on the server shows UTC. Admin screens therefore
// send the instant (ISO 8601) with a UTC fallback, and the admin script rewrites it in the
// viewer's own time zone (LOCAL_TIME_SCRIPT), like the dates the browser shows elsewhere.
const h=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));

/** ISO instant of a time given as epoch milliseconds or a date string; null when it is not a time. */
export function isoInstant(value: number | string | Date | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** UTC text shown until the script runs (and without JavaScript). */
export function utcFallback(iso: string, lang: string): string {
  return new Date(iso).toLocaleString(lang === 'ja' ? 'ja-JP' : 'en-US', { timeZone: 'UTC', dateStyle: 'short', timeStyle: 'short' }) + ' UTC';
}

/** A time element the admin script shows in the viewer's local time. */
export function localTime(value: number | string | Date | null | undefined, lang: string): string {
  const iso = isoInstant(value);
  if (!iso) return h(String(value ?? ''));
  return `<time datetime="${iso}" data-local-time="${iso}">${h(utcFallback(iso, lang))}</time>`;
}

/**
 * Rewrites every [data-local-time] element (time, span, option…) in the viewer's time zone.
 * An optional data-local-suffix is appended (used by option labels, which cannot hold markup).
 */
export function localTimeScript(lang: string): string {
  const locale = lang === 'ja' ? 'ja-JP' : 'en-US';
  return `(function(){const f=new Intl.DateTimeFormat(${JSON.stringify(locale)},{dateStyle:'short',timeStyle:'short'});window.mikanBoxLocalTimes=function(root){(root||document).querySelectorAll('[data-local-time]').forEach(function(el){const d=new Date(el.getAttribute('data-local-time'));if(!isNaN(d.getTime()))el.textContent=f.format(d)+(el.getAttribute('data-local-suffix')||'');});};window.mikanBoxLocalTimes();})();`;
}
