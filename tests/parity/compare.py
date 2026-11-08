# Compare PHP and Cloud outputs. Markdown, data and API outputs are compared exactly;
# HTML is compared for the parts the output formats touch (links, NAV, categories, alternate link).
import difflib,os,re,sys
out=sys.argv[1]; php=os.path.join(out,'php'); cloud=os.path.join(out,'cloud')
names=sorted(set(os.listdir(php))|set(os.listdir(cloud)))
def norm_html(s):
    s=re.sub(r'<script src="[^"]*ai-question\.js[^"]*"[^>]*></script>','',s)
    s=re.sub(r'<div data-mikanbox-ai-question[^>]*></div>','',s)
    s=re.sub(r'<form class="mikan-search-form[\s\S]*?</script>','',s)
    s=re.sub(r"&#0?39;","'",s)
    s=re.sub(r'\s+',' ',s)
    return s.strip()
same=diff=0
for n in names:
    a=open(os.path.join(php,n),encoding='utf-8').read() if os.path.exists(os.path.join(php,n)) else None
    b=open(os.path.join(cloud,n),encoding='utf-8').read() if os.path.exists(os.path.join(cloud,n)) else None
    if n.endswith('.html') and a is not None and b is not None: a,b=norm_html(a),norm_html(b)
    if n.endswith('.api') and a is not None and b is not None: a=re.sub(r'"fields": \[\]','"fields": {}',a)
    if a==b: same+=1; continue
    diff+=1; print('=== DIFF',n, '(missing in PHP)' if a is None else '(missing in Cloud)' if b is None else '')
    if a is not None and b is not None:
        for line in list(difflib.unified_diff(a.splitlines(),b.splitlines(),'php','cloud',lineterm='',n=0))[:14]:
            if line.startswith(('-','+')) and not line.startswith(('---','+++')) and len(line)>220:
                o=[l for l in (a if line[0]=='-' else b).splitlines()]
            print('  '+line[:220])
        if n.endswith('.html'):
            i=next((k for k in range(min(len(a),len(b))) if a[k]!=b[k]),0); print('  php  : …'+a[max(0,i-80):i+160]); print('  cloud: …'+b[max(0,i-80):i+160])
print(f'{same} identical, {diff} different')
