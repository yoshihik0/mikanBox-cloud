#!/bin/bash
# Output formats (2.17.0–2.18.1): render the same pages with the PHP renderer (flat edition)
# and the Cloud renderer, and compare the Markdown versions, data formats and mikanBox DB JSON.
#   bash tests/parity/run.sh [output dir]   (needs php, node, python3 and the adjacent mikanBox-flat checkout)
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"; CLOUD="$(cd "$HERE/../.." && pwd)"; FLAT="$CLOUD/../mikanBox-flat"
OUT="${1:-${TMPDIR:-/tmp}/mikanbox-output-parity}"; rm -rf "$OUT"; mkdir -p "$OUT/site"
(cd "$CLOUD" && npx tsc --module Node16 --moduleResolution Node16 --outDir .test-build >/dev/null)
rsync -a --exclude mikanData --exclude .git --exclude tests "$FLAT/" "$OUT/site/"
python3 -I - "$HERE/corpus.json" "$OUT" <<'PY'
import json,os,sys
corpus=json.load(open(sys.argv[1],encoding='utf-8')); out=sys.argv[2]
for kind in ('posts','components'):
    os.makedirs(f'{out}/site/mikanData/{kind}',exist_ok=True)
    for k,v in corpus[kind].items(): json.dump(v,open(f'{out}/site/mikanData/{kind}/{k}.json','w',encoding='utf-8'),ensure_ascii=False)
json.dump({'site_name':'Parity Site','description':'site desc','ogp_image':'','ssg_root_url':'https://example.test'},open(f'{out}/site/mikanData/settings.json','w'))
json.dump(list(corpus['posts']),open(f'{out}/ids.json','w'))
PY
php "$HERE/render_php.php" "$OUT/site" "$OUT/php" "$OUT/ids.json"
node "$HERE/render_cloud.cjs" "$CLOUD" "$OUT/cloud" "$HERE/corpus.json"
python3 -I "$HERE/compare.py" "$OUT"
