const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

test('editor preview posts a copy of the current form in a separate tab',()=>{
  let listener,submitted,removed=false;
  const editor={entries:[['id','example'],['title','Unsaved title'],['content_md','Unsaved image'],['csrf_token','token'],['save_action','save_page']]};
  const button={dataset:{editorPreview:'/admin?editor_preview=1'}};
  const document={addEventListener:(type,fn)=>{if(type==='click')listener=fn;},getElementById:id=>id==='page-form'?editor:null,
    body:{appendChild(){}},createElement:type=>type==='form'?{fields:[],appendChild(input){this.fields.push(input);},submit(){submitted=this;},remove(){removed=true;}}:{}};
  class FormDataMock {constructor(form){this.entries=form.entries.map(pair=>pair.slice());}set(key,value){this.entries=this.entries.filter(([k])=>k!==key);this.entries.push([key,value]);}[Symbol.iterator](){return this.entries[Symbol.iterator]();}}
  vm.runInNewContext(fs.readFileSync('public/mikanbox/preview-editor.js','utf8'),{document,FormData:FormDataMock});
  let prevented=false;listener({target:{closest:()=>button},preventDefault(){prevented=true;}});
  assert.ok(prevented&&removed);assert.equal(submitted.method,'post');assert.equal(submitted.target,'_blank');assert.equal(submitted.action,'/admin?editor_preview=1');
  assert.deepEqual(Object.fromEntries(submitted.fields.map(x=>[x.name,x.value])),{id:'example',title:'Unsaved title',content_md:'Unsaved image',csrf_token:'token',save_action:'preview_page'});
  assert.equal(editor.entries.at(-1)[1],'save_page');
});
