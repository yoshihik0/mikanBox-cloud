const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const window={};vm.runInNewContext(fs.readFileSync('public/mikanbox/cloud-export.js','utf8'),{window,document:{documentElement:{lang:'en'},addEventListener(){}},FormData,TextEncoder,TextDecoder});
const relative=window.__mikanExportRelative;
test('"Use relative paths" writes root links from each file\'s position, as the PHP relative build does',()=>{
 assert.equal(relative('<a href="/">H</a><a href="/about">A</a>','index.html'),'<a href=".">H</a><a href="about">A</a>');
 assert.equal(relative('<a href="/">H</a><img src="/media/a.png" srcset="/media/a.png 1x, /media/b.png 2x">','news/post.html'),'<a href="../">H</a><img src="../media/a.png" srcset="../media/a.png 1x, ../media/b.png 2x">');
 assert.equal(relative('.a{background:url(/media/bg.png)}','style.css'),'.a{background:url(media/bg.png)}');
 const kept='<a href="https://x.test/">x</a><a href="//cdn.test/a.js">c</a><a href="#top">t</a><a href="about">r</a>';
 assert.equal(relative(kept,'a/b.html'),kept,'other addresses stay as they are');
});
