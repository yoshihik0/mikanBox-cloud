const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(new URL('../public/mikanbox/cloud-media.js', `file://${__filename}`), 'utf8');

function loadMediaApi({ bitmap = { width: 4000, height: 2000 }, webpSupported = true } = {}) {
  const calls = { canvas: 0, draw: [] };
  const context = {
    window: {},
    document: {
      createElement(name) {
        assert.equal(name, 'canvas');
        calls.canvas++;
        return {
          width: 0,
          height: 0,
          getContext: () => ({ drawImage: (...args) => calls.draw.push(args.slice(1)) }),
          toBlob(callback, type) {
            callback(new Blob([], { type: type === 'image/webp' && !webpSupported ? 'image/png' : type }));
          },
        };
      },
    },
    Blob,
    File,
    createImageBitmap: async () => ({ ...bitmap, close() {} }),
    fetch: async () => { throw new Error('unexpected fetch'); },
  };
  vm.runInNewContext(source, context);
  return { prepare: context.window.cloudPrepareMediaForm, calls };
}

function form(entries) {
  const values = new Map(Object.entries(entries));
  return {
    get: key => values.get(key) ?? null,
    set: (key, value) => values.set(key, value),
    entries: () => values.entries(),
  };
}

test('WebP upload changes the file extension and encodes WebP bytes', async () => {
  const { prepare, calls } = loadMediaApi();
  const input = new File(['image'], 'photo.jpeg', { type: 'image/jpeg' });
  const result = await prepare(form({ save_action: 'upload_media', image: input, opt_resize: '1', opt_max_dim: '2000', opt_webp: '1' }));
  const output = result.get('image');
  assert.equal(output.name, 'photo.webp');
  assert.equal(output.type, 'image/webp');
  assert.deepEqual(calls.draw[0], [0, 0, 2000, 1000]);
});

test('animated GIF upload is preserved without canvas processing', async () => {
  const { prepare, calls } = loadMediaApi();
  const input = new File(['gif'], 'animation.gif', { type: 'image/gif' });
  const result = await prepare(form({ save_action: 'upload_media', image: input, opt_resize: '1', opt_max_dim: '2000', opt_webp: '1' }));
  assert.equal(result.get('image'), input);
  assert.equal(calls.canvas, 0);
});

test('resize rejects dimensions beyond the browser safety limit', async () => {
  const { prepare } = loadMediaApi({ bitmap: { width: 20000, height: 20000 } });
  const request = form({ save_action: 'resize_media', file: 'large.png', image: new File(['image'], 'large.png', { type: 'image/png' }), new_width: '1200' });
  await assert.rejects(prepare(request), /browser processing limit/);
});

test('WebP conversion fails clearly when the browser encoder is unavailable', async () => {
  const { prepare } = loadMediaApi({ webpSupported: false });
  const input = new File(['image'], 'photo.png', { type: 'image/png' });
  const request = form({ save_action: 'upload_media', image: input, opt_webp: '1' });
  await assert.rejects(prepare(request), /cannot create image\/webp/);
});

test('unified editing supports filename-only changes without decoding an image',async()=>{
 const {prepare,calls}=loadMediaApi();const request=form({save_action:'edit_media',file:'photo.png',new_filename:'renamed.png'});
 const result=await prepare(request);assert.equal(result.get('new_filename'),'renamed.png');assert.equal(result.get('image'),null);assert.equal(calls.canvas,0);
});
test('unified editing combines resize and custom filename with automatic WebP extension',async()=>{
 const {prepare,calls}=loadMediaApi();const request=form({save_action:'edit_media',file:'photo.png',new_filename:'news_cover.png',new_width:'1200',opt_webp:'1',image:new File(['image'],'photo.png',{type:'image/png'})});
 const result=await prepare(request);assert.equal(result.get('source_file'),'photo.png');assert.equal(result.get('new_filename'),'news_cover.webp');assert.equal(result.get('image').name,'news_cover.webp');assert.equal(result.get('image').type,'image/webp');assert.deepEqual(calls.draw[0],[0,0,1200,600]);
});


test('dedicated WebP action preserves dimensions and rejects non-JPEG/PNG inputs',async()=>{
 const {prepare,calls}=loadMediaApi({bitmap:{width:800,height:600}});
 const input=form({save_action:'convert_media_webp',file:'photo.jpeg',opt_webp:'1',image:new File(['image'],'photo.jpeg',{type:'image/jpeg'})});
 const result=await prepare(input);assert.equal(result.get('new_filename'),'photo.webp');assert.equal(result.get('source_file'),'photo.jpeg');assert.deepEqual(calls.draw[0],[0,0,800,600]);
 for(const file of ['photo.webp','animation.gif','vector.svg','audio.mp3'])await assert.rejects(prepare(form({save_action:'convert_media_webp',file,opt_webp:'1'})),/JPEG and PNG only/);
});


test('JS and CSS bypass browser image processing even when the supplied MIME claims an image', async () => {
  const { prepare, calls } = loadMediaApi();
  for (const name of ['library.js', 'library.css']) {
    const input = new File(['original code'], name, { type: 'image/jpeg' });
    const result = await prepare(form({ save_action: 'upload_media', image: input, opt_resize: '1', opt_max_dim: '2000', opt_webp: '1' }));
    assert.equal(result.get('image'), input);
  }
  assert.equal(calls.canvas, 0);
});
