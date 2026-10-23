import presets from './defaults-data.json';
import type {Env,PageData,ComponentData} from './types';
export function standardDefaults(language: string) {
  return presets[language==='en'?'en':'ja'] as {pages:Record<string,PageData>;components:Record<string,ComponentData>};
}
// Fresh installation only: keep every existing page/component unchanged.
export async function installDefaults(env: Env,language: string) {
  const defaults=standardDefaults(language),statements:D1PreparedStatement[]=[];
  for(const [id,data] of Object.entries(defaults.components)) {
    statements.push(env.DB.prepare('INSERT INTO components(id,data,is_wrapper) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING')
      .bind(id,JSON.stringify(data),data.is_wrapper?1:0));
  }
  for(const [id,data] of Object.entries(defaults.pages)) {
    const page={...data,revision_tag:crypto.randomUUID()};
    statements.push(env.DB.prepare('INSERT INTO posts(id,data,status,sort_order,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING')
      .bind(id,JSON.stringify(page),page.status,page.sort_order||0,page.updated_at||''));
  }
  await env.DB.batch(statements);
}
