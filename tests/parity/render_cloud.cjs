// usage: node render_cloud.cjs <cloud dir> <output dir> <corpus.json>
const fs=require('node:fs'),path=require('node:path');
const [cloud,out,corpus]=process.argv.slice(2);
const {environment}=require(path.join(cloud,'tests/fixtures.cjs'));
const {savePage,saveComponent,saveSettings}=require(path.join(cloud,'.test-build/src/storage.js'));
const {MikanBoxRenderer}=require(path.join(cloud,'.test-build/src/renderer.js'));
(async()=>{
  const env=environment(),settings={site_name:'Parity Site',description:'site desc',ogp_image:'',ssg_root_url:'https://example.test'};
  await saveSettings(env,settings);
  const c=JSON.parse(fs.readFileSync(corpus,'utf8'));
  for(const [id,data] of Object.entries(c.components))await saveComponent(env,id,data);
  for(const [id,data] of Object.entries(c.posts))await savePage(env,id,data);
  fs.mkdirSync(out,{recursive:true});
  for(const id of Object.keys(c.posts)){
    const r=()=>new MikanBoxRenderer(env,settings,new Request('https://example.test/'+id));
    const html=await r().render(id);
    const outputs={html:html.status===200||id==='404'?html.html:'<h1>404 Not Found</h1>',md:await r().renderMarkdown(id),data:await r().renderData(id),api:await r().renderApi(id)};
    for(const [kind,body] of Object.entries(outputs))if(body!==null)fs.writeFileSync(path.join(out,id.replace(/\//g,'__')+'.'+kind),String(body));
  }
  console.log(Object.keys(c.posts).length+' rendered by Cloud');
})();
