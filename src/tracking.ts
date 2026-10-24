import type { ComponentData, Settings } from './types';

export type TrackingSnippets = { head: string; body: string };

/** Direct code wins over an ID; an ID builds the standard Google snippets; null leaves the legacy tracking component. */
export function trackingSnippets(settings: Settings): TrackingSnippets | null {
  const head = String(settings.tracking_head_code || '').trim();
  const body = String(settings.tracking_body_code || '').trim();
  if (head || body) return { head, body };
  const id = String(settings.tracking_id || '').trim().toUpperCase();
  if (/^GTM-[A-Z0-9]{4,}$/.test(id)) return {
    head: `<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${id}');</script>`,
    body: `<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${id}" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`,
  };
  if (/^G-[A-Z0-9]{4,}$/.test(id)) return {
    head: `<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${id}');</script>`,
    body: '',
  };
  return null;
}

export const trackingIdValid = (id: string) => id === '' || /^(?:GTM|G)-[A-Z0-9]{4,}$/.test(id.toUpperCase());

/** HTML of the legacy tracking component when it can move into the head code field unchanged. */
export function trackingLegacyHtml(component: ComponentData | null | undefined): string | null {
  if (!component || component.is_ai_doc || component.is_wrapper) return null;
  const html = String(component.html || '');
  if (html.includes('{{') || String(component.js || '').trim() || String(component.css || '').trim()) return null;
  return html;
}

export const trackingConfigured = (settings: Settings) => trackingSnippets(settings) !== null || !!settings.tracking_component;
