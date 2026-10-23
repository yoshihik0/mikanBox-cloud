const reserved = new Set(['mikanbox', 'media', 'api', 'admin', 'mcp', 'public-mcp', 'component-js', 'sitemap.xml', 'rss.xml', 'podcast.xml']);
export function validId(id: string, component = false): boolean {
  if (!id || id.length > 200 || id.includes('..')) return false;
  return component ? /^[A-Za-z0-9_-]+(?:\.md)?$/.test(id) : /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(id);
}
export function pageId(id: string): string {
  if (!validId(id) || reserved.has(id.split('/')[0].toLowerCase()))
    throw new Error('ページIDを確認してください。 / Invalid or reserved page ID.');
  return id;
}
export function componentId(id: string): string {
  if (!validId(id, true)) throw new Error('コンポーネントIDを確認してください。 / Invalid component ID.');
  return id;
}
export function pageStatus(status: string) {
  if (!['draft', 'pending', 'public_dynamic', 'public_static', 'db'].includes(status))
    throw new Error('公開状態を確認してください。 / Invalid status.');
  return status as 'draft' | 'pending' | 'public_dynamic' | 'public_static' | 'db';
}
