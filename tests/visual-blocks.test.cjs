// Block splitting for visual editing. The cases (and the expected ranges for the extra ones, taken from the PHP
// implementation) are the same as shared/tests/visual_blocks_test.php, so the two editions split identically.
const test=require('node:test'),assert=require('node:assert/strict');
const {splitBlocks,injectMarkers,applyMarkers,isDoc}=require('../.test-build/src/visual-blocks.js');
const ranges=src=>splitBlocks(src).map(b=>b.start+'-'+b.end).join(',');
const nav='<nav>\n<div>\n\n<a>\n<span>01</span>\n\n<span>t</span>\n</a>\n\n<a>\n</a>\n</div>\n</nav>';
const cases={
 'nested html with blank lines is one block':[`# T\n\n${nav}\n\ntext\n`,'0-0,2-14,16-16'],
 'an unclosed tag later does not split earlier html':[`${nav}\n\n<div>\nopen\n\nafter\n`,'0-12,14-15,17-17'],
 'plain markdown still splits on blank lines':['a\n\nb\n\nc\n','0-0,2-2,4-4'],
 'tags inside a code fence are ignored':['```\n<div>\n```\n\nx\n','0-2,4-4'],
 'lists, data blocks, mixed fences and an unclosed div':['<div>\nopen\n\nafter\n\n```\n<div>\n```\n\n1. a\n\n   b\n\n2. c\n\n{{DATAROW:x}}\n\n{{/DATAROW}}\n\nz','0-1,3-3,5-7,9-13,15-17,19-19'],
 'only ASCII whitespace is blank (full-width and no-break spaces are text)':['a\n　\nb\n\n \nc\n\n~~~js\n\n~~~~\n\n- x\n\n- y\n\n  z\n\n<span>a</span> <a href=\'x\'>t</a>\n\n<p>\n</p>\n','0-2,4-5,7-9,11-15,17-17,19-20'],
 'a DATA range is one block':['{{DATA:a}}\nx\n\ny\n{{/DATA}}\n\nafter {{DATAROW:r}}{{/DATAROW}} one\n\n{{DATA:b}} {{/DATA}}\nlast','0-4,6-6,8-9'],
 'a DATA range closing inside open HTML does not split it':["<section class=\"section\">\n<div class=\"container text-center\">\n\n## Latte Art\n\n![ラテアート](coffee_gallery1.webp)\n\n{{DATA:CATCH}}一杯ずつ丁寧にお作りするラテアートです。{{/DATA}}\n\n{{DATA:ITEM:GHOST}}Latte{{/DATA}}\n{{DATA:PRICE:GHOST}}550円{{/DATA}}\n{{DATA:BADGE:GHOST}}人気{{/DATA}}\n\n{{DATAROW:MENU}}\n{{DATA:ITEM}}Latte{{/DATA}}\n{{DATA:PRICE}}550円{{/DATA}}\n{{/DATAROW}}\n\nPhoto by {{DATA:name}}Paul{{/DATA}}\n{{DATA:date:GHOST}}2025-05-01{{/DATA}}\n\n</div>\n</section>",'0-22'],
 'a code fence closing inside open HTML does not split it':['<div>\n\n```\nx\n```\n\ntext\n\n</div>','0-8'],
 'comments are not tags':['<div><div>a</div>\n\n<div>b</div></div>\n\n<!-- c -->\n<div>\n<!-- </div> -->\n\nx\n</div>\n','0-2,4-9'],
};
for(const [label,[src,want]] of Object.entries(cases))test(label,()=>assert.equal(ranges(src),want));
test('markers wrap each block and are unwrapped from paragraphs again',()=>{
 assert.equal(injectMarkers('a\n\nb'),'<!--fv:0-0-->\n\na\n\n<!--/fv-->\n\n<!--fv:2-2-->\n\nb\n\n<!--/fv-->');
 assert.equal(applyMarkers('<p><!--fv:0-0--></p>\n<p>a</p>\n<p><!--/fv--></p>\n'),'<!--fv:0-0--><p>a</p>\n<!--/fv-->');
});
test('only a Raw HTML page with <html> or <body> is a document',()=>{
 assert.equal(isDoc({is_html:true,content_md:'<!doctype html><html><body>x</body></html>'}),true);
 assert.equal(isDoc({is_html:true,content_md:'<div>x</div>'}),false);
 assert.equal(isDoc({is_html:false,content_md:'<body>'}),false);
});
