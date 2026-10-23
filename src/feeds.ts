// ==========================================
// mikanBox Feed Generation (functions.php 各generateXml関数の移植)
// ==========================================

import type { Env, Settings } from './types';
import { loadPage, listPages, isPublicStatus } from './storage';
import { MikanBoxRenderer } from './renderer';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function rfc822(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return new Date().toUTCString();
  return d.toUTCString().replace('GMT', '+0000');
}

export async function generateSitemapXml(env: Env, settings: Settings, request: Request): Promise<string> {
  const renderer = new MikanBoxRenderer(env, settings, request);
  const siteUrl = renderer.getSiteUrl().replace(/\/$/, '');
  const allPosts = await listPages(env);

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

  for (const {id:pageId,data} of allPosts) {
    if (!data) continue;
    if (!isPublicStatus(data.status)) continue;
    const loc = esc(siteUrl + '/' + (pageId === 'index' ? '' : pageId));
    const lastmod = (data.updated_at || new Date().toISOString()).slice(0, 10);
    xml += `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>\n`;
  }

  xml += '</urlset>\n';
  return xml;
}

export async function generateRssXml(env: Env, settings: Settings, request: Request): Promise<string> {
  const renderer = new MikanBoxRenderer(env, settings, request);
  const siteUrl = renderer.getSiteUrl().replace(/\/$/, '');
  const siteTitle = esc(settings.site_name || 'mikanBox');
  const siteDesc = esc(settings.description || '');
  const allPosts = await listPages(env);

  type Item = { id: string; data: Awaited<ReturnType<typeof loadPage>> };
  const items: Item[] = [];
  for (const {id:pageId,data} of allPosts) {
    if (!data) continue;
    if (!isPublicStatus(data.status)) continue;
    items.push({ id: pageId, data });
  }
  items.sort((a, b) => {
    const ta = a.data?.updated_at || '';
    const tb = b.data?.updated_at || '';
    return tb.localeCompare(ta);
  });
  const limited = items.slice(0, 20);

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n<channel>\n';
  xml += `  <title>${siteTitle}</title>\n  <link>${siteUrl}/</link>\n`;
  xml += `  <description>${siteDesc}</description>\n  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>\n`;

  for (const item of limited) {
    const d = item.data!;
    const title = esc(d.title || item.id);
    const desc = esc(d.description || '');
    const link = esc(siteUrl + '/' + (item.id === 'index' ? '' : item.id));
    const pubDate = rfc822(d.updated_at || new Date().toISOString());
    xml += `  <item>\n    <title>${title}</title>\n    <link>${link}</link>\n`;
    xml += `    <description>${desc}</description>\n    <pubDate>${pubDate}</pubDate>\n`;
    xml += `    <guid>${link}</guid>\n  </item>\n`;
  }

  xml += '</channel>\n</rss>\n';
  return xml;
}

export async function generatePodcastXml(env: Env, settings: Settings, request: Request): Promise<string> {
  const renderer = new MikanBoxRenderer(env, settings, request);
  const siteUrl = renderer.getSiteUrl().replace(/\/$/, '');
  const siteTitle = esc(settings.site_name || 'mikanBox');
  const siteDesc = esc(settings.description || '');
  const author = siteTitle;
  let ogpImage = settings.ogp_image || '';
  if (ogpImage && !/^https?:\/\//.test(ogpImage)) {
    ogpImage = siteUrl + '/media/' + ogpImage.replace(/^\//, '');
  }

  const allPosts = await listPages(env);
  type Item = { id: string; data: Awaited<ReturnType<typeof loadPage>> };
  const items: Item[] = [];

  for (const {id:pageId,data} of allPosts) {
    if (!data) continue;
    if (!isPublicStatus(data.status)) continue;
    const cats = (data.category || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!cats.includes('podcast')) continue;
    items.push({ id: pageId, data });
  }
  items.sort((a, b) => (b.data?.updated_at || '').localeCompare(a.data?.updated_at || ''));

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">\n<channel>\n';
  xml += `  <title>${siteTitle}</title>\n  <link>${siteUrl}/</link>\n`;
  xml += `  <description>${siteDesc}</description>\n  <language>ja</language>\n`;
  xml += `  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>\n`;
  xml += `  <itunes:author>${author}</itunes:author>\n`;
  xml += `  <itunes:summary>${siteDesc}</itunes:summary>\n`;
  if (ogpImage) xml += `  <itunes:image href="${esc(ogpImage)}"/>\n`;
  xml += `  <itunes:explicit>false</itunes:explicit>\n`;

  for (const item of items) {
    const d = item.data!;
    const content = d.content_md || '';
    const dataGet = (key: string): string => {
      const m = content.match(new RegExp(`\\{\\{DATA:${key}(?::GHOST)?\\}\\}([^{]+)\\{\\{/DATA\\}\\}`, 'i'));
      return (m?.[1] || '').trim();
    };

    let audioFile = dataGet('AUDIO_FILE');
    if (!audioFile) continue;
    if (!/^https?:\/\//.test(audioFile)) audioFile = siteUrl + '/media/' + audioFile;

    const duration = dataGet('DURATION');
    const fileSize = parseInt(dataGet('FILE_SIZE') || '0', 10);
    const episodeNum = dataGet('EPISODE_NUM');
    const season = dataGet('SEASON');
    const subtitle = dataGet('SUBTITLE');
    const episodeType = dataGet('EPISODE_TYPE') || 'full';
    const explicit = dataGet('EXPLICIT') || 'false';
    let epImage = dataGet('EPISODE_IMAGE');
    if (epImage && !/^https?:\/\//.test(epImage)) epImage = siteUrl + '/media/' + epImage;

    const ext = audioFile.split('.').pop()?.toLowerCase() || 'mp3';
    const mimeMap: Record<string, string> = { mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', wav: 'audio/wav' };
    const mime = mimeMap[ext] || 'audio/mpeg';
    const title = esc(d.title || item.id);
    const desc = esc(d.description || '');
    const link = esc(siteUrl + '/' + item.id);
    const pubDate = rfc822(d.updated_at || new Date().toISOString());

    xml += `  <item>\n    <title>${title}</title>\n    <link>${link}</link>\n`;
    xml += `    <description>${desc}</description>\n    <pubDate>${pubDate}</pubDate>\n`;
    xml += `    <guid>${link}</guid>\n`;
    xml += `    <enclosure url="${esc(audioFile)}" length="${fileSize}" type="${mime}"/>\n`;
    if (duration) xml += `    <itunes:duration>${duration}</itunes:duration>\n`;
    if (subtitle) xml += `    <itunes:subtitle>${esc(subtitle)}</itunes:subtitle>\n`;
    if (episodeNum) xml += `    <itunes:episode>${episodeNum}</itunes:episode>\n`;
    if (season) xml += `    <itunes:season>${season}</itunes:season>\n`;
    if (epImage) xml += `    <itunes:image href="${esc(epImage)}"/>\n`;
    xml += `    <itunes:episodeType>${episodeType}</itunes:episodeType>\n`;
    xml += `    <itunes:explicit>${explicit}</itunes:explicit>\n`;
    xml += `    <itunes:summary>${desc}</itunes:summary>\n  </item>\n`;
  }

  xml += '</channel>\n</rss>\n';
  return xml;
}
