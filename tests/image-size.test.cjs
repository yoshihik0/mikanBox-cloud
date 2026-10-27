const {test}=require('node:test'),assert=require('node:assert/strict');
const {environment}=require('./fixtures.cjs');
const {r2Environment}=require('./r2-fixture.cjs');
const {imageSize}=require('../.test-build/src/image-size.js');
const {uploadMedia,savePage,saveComponent,loadSettings,listPages,listComponents}=require('../.test-build/src/storage.js');
const {MikanBoxRenderer}=require('../.test-build/src/renderer.js');

const png=(w,h)=>{const b=new Uint8Array(40);b.set([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);new DataView(b.buffer).setUint32(16,w);new DataView(b.buffer).setUint32(20,h);return b;};
const gif=(w,h)=>{const b=new Uint8Array(20);b.set([71,73,70,56,57,97,w&255,w>>8,h&255,h>>8]);return b;};
const jpeg=(w,h)=>new Uint8Array([255,216,255,224,0,4,0,0,255,192,0,17,8,h>>8,h&255,w>>8,w&255,3,1,34,0,2,17,1,3,17,1]);

test('image sizes are read from PNG, GIF and JPEG headers, and refused for other bytes',()=>{
 assert.deepEqual(imageSize(png(640,480)),{width:640,height:480});
 assert.deepEqual(imageSize(gif(300,200)),{width:300,height:200});
 assert.deepEqual(imageSize(jpeg(1200,800)),{width:1200,height:800});
 assert.equal(imageSize(new Uint8Array([1,2,3,4,5,6,7,8,9,10,11,12])),null);
});

for(const [label,make] of [['D1',environment],['R2',r2Environment]])test(`${label}: static builds add width, height and loading hints to local images in PHP's order`,async()=>{
 const env=make();
 await uploadMedia(env,'big.png',png(800,600).buffer,'image/png');
 await uploadMedia(env,'second.png',png(640,360).buffer,'image/png');
 await uploadMedia(env,'icon.png',png(32,32).buffer,'image/png');
 await uploadMedia(env,'photo.jpg',jpeg(1200,800).buffer,'image/jpeg');
 await savePage(env,'p',{title:'p',content_md:'![a](big.png)\n\n![b](icon.png)\n\n![c](second.png)\n\n{{IMAGE:photo.jpg}}\n\n![gone](missing.png)\n\n![ext](https://example.com/x.png)\n\n<img src="media/big.png">',wrapper_comp:'',status:'public_static'});
 const settings=await loadSettings(env),snapshot={pages:await listPages(env),components:await listComponents(env)};
 const render=(snap,options)=>new MikanBoxRenderer(env,settings,new Request('https://x.test/p'),snap,options).render('p').then(r=>r.html);
 const html=await render(snapshot);
 assert.match(html,/<img src="https:\/\/x\.test\/media\/big\.png" alt="a" width="800" height="600" fetchpriority="high">/);
 assert.match(html,/<img src="https:\/\/x\.test\/media\/icon\.png" alt="b" width="32" height="32">/);
 assert.match(html,/<img src="https:\/\/x\.test\/media\/second\.png" alt="c" width="640" height="360" loading="lazy" decoding="async">/);
 assert.match(html,/style="max-width:100%; height:auto;" width="1200" height="800" loading="lazy" decoding="async">/);
 assert.match(html,/<img src="https:\/\/x\.test\/media\/missing\.png" alt="gone">/);
 assert.match(html,/<img src="https:\/\/example\.com\/x\.png" alt="ext">/);
 assert.match(html,/<img src="https:\/\/x\.test\/media\/big\.png">/);
 assert.doesNotMatch(html,/data-mkn-dim/);
 // Live rendering reads nothing and leaves the image tags as before.
 const live=await render(undefined);
 assert.doesNotMatch(live,/data-mkn-dim|width="800"/);
 assert.match(live,/<img src="https:\/\/x\.test\/media\/big\.png" alt="a">/);
});
