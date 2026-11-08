<?php
// usage: php render_php.php <site dir> <output dir> <ids.json>
// Renders every output of each page with the PHP renderer (flat edition, dynamic serving).
[$self,$site,$out,$idsFile]=$argv;
$ids=json_decode(file_get_contents($idsFile),true);
$_SERVER['SCRIPT_FILENAME']=$site.'/index.php'; $_SERVER['SCRIPT_NAME']='/index.php'; $_SERVER['DOCUMENT_ROOT']=$site;
$_SERVER['HTTP_HOST']='example.test'; $_SERVER['HTTPS']='on'; $_SERVER['REQUEST_URI']='/'; $_SERVER['REQUEST_METHOD']='GET';
error_reporting(E_ALL & ~E_DEPRECATED); ini_set('display_errors','0');
require $site.'/mikanBox/config.php';
require $site.'/mikanBox/lib/functions.php';
require $site.'/mikanBox/lib/renderer.php';
$settings=loadSettings();
@mkdir($out,0777,true);
foreach($ids as $id){
    $r=new MikanBoxRenderer($settings);
    $outputs=['html'=>$r->render($id),'md'=>$r->renderMarkdown($id),'data'=>$r->renderData($id),'api'=>$r->renderApi($id)];
    foreach($outputs as $kind=>$body) if($body!==null) file_put_contents($out.'/'.str_replace('/','__',$id).'.'.$kind,(string)$body);
}
echo count($ids)," rendered by PHP\n";
