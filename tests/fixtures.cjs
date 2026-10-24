const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs');
const path=require('node:path');
function environment() {
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
  for(const file of fs.readdirSync(path.join(__dirname,'../migrations')).sort())sqlite.exec(fs.readFileSync(path.join(__dirname,'../migrations',file),'utf8'));
  const DB={
    prepare(sql) {return {
      args:[],bind(...args){this.args=args.map(value=>value instanceof ArrayBuffer?new Uint8Array(value):value);return this;},
      async first(column){const row=sqlite.prepare(sql).get(...this.args);return column?(row?.[column]??null):(row??null);},
      async all(){return {success:true,results:sqlite.prepare(sql).all(...this.args)};},
      async run(){const r=sqlite.prepare(sql).run(...this.args);return {success:true,results:[],meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}};}
    };},
    async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}
  };
  return {DB,sqlite,JWT_SECRET:'test-secret-'.repeat(4),SETUP_TOKEN:'test-setup-token'};
}
const worker=require('../.test-build/src/index.js').default;
async function call(env,url='/admin',data,cookie) {
  const headers={};if(cookie)headers.Cookie=cookie;
  const options={headers};
  if(data){options.method='POST';options.body=new URLSearchParams(data);}
  return worker.fetch(new Request('https://cloud.test'+url,options),env);
}
// Registers a device through the real setup form for the first user; later users get a device directly.
async function login(env,username='admin',display_name='Admin') {
  const devices=require('../.test-build/src/devices.js');
  let cookie;
  if(!env.sqlite.prepare('SELECT 1 FROM users').get()) {
    const page=await call(env,'/admin'),csrfCookie=page.headers.get('Set-Cookie').match(/login_csrf=([^;]+)/);
    const response=await worker.fetch(new Request('https://cloud.test/admin',{method:'POST',headers:{Cookie:csrfCookie[0]},body:new URLSearchParams({login_action:'setup',csrf_token:csrfCookie[1],setup_token:env.SETUP_TOKEN,username,display_name,device_name:'Test device'})}),env);
    if(response.status!==303)throw new Error(await response.text());
    cookie=response.headers.get('Set-Cookie').split(';')[0];
  } else {
    env.sqlite.prepare("INSERT INTO users(username,display_name,password_hash,auth_version) VALUES(?,?,'',1) ON CONFLICT(username) DO NOTHING").run(username,display_name);
    cookie=(await devices.createDevice(env,username,'Test device',new Request('https://cloud.test/admin'))).cookie.split(';')[0];
  }
  const session=await devices.deviceSession(new Request('https://cloud.test/admin',{headers:{Cookie:cookie}}),env);
  return {cookie,csrf_token:session.csrf,username};
}
async function post(env,auth,data,url='/admin') {
  const response=await call(env,url,{...data,csrf_token:auth.csrf_token,ajax_request:'1'},auth.cookie);
  return {response,data:await response.json()};
}
// Public pages are only served as built static files, so tests that check page
// output render it the way the build does instead of requesting it from the Worker.
async function publicView(env,path='/') {
  const {MikanBoxRenderer}=require('../.test-build/src/renderer.js'),{loadSettings}=require('../.test-build/src/storage.js');
  const url=new URL('https://cloud.test'+path),id=url.pathname.replace(/^\/+|\/+$/g,'').replace(/\.html$/,'')||'index';
  const result=await new MikanBoxRenderer(env,await loadSettings(env),new Request(url)).render(id);
  return {status:result.status,text:async()=>result.html};
}
module.exports={environment,call,login,post,publicView};
