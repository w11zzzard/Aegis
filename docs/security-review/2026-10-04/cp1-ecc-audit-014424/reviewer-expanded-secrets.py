"""Additional unique-history-blob credential assignment rules; report no values."""
import json
from pathlib import Path
import re
import subprocess
import sys

root=Path(sys.argv[1]).resolve()
base=['git','-c','safe.directory='+str(root),'-C',str(root)]
def git(*args):
    return subprocess.run([*base,*args],check=True,capture_output=True).stdout

objects=git('rev-list','--objects','--all').splitlines()
paths={line.split(b' ',1)[0]:line.split(b' ',1)[1].decode('utf-8') for line in objects if b' ' in line}
checked=git('cat-file','--batch-check').decode() if not paths else subprocess.run([*base,'cat-file','--batch-check'],input=b'\n'.join(paths)+b'\n',check=True,capture_output=True).stdout.decode()
selected=[]
for line in checked.splitlines():
    oid,kind,size=line.split()
    if kind=='blob' and int(size)<=2097152 and not paths[oid.encode()].endswith(('.png','.jpg','.pdf','.woff','.woff2')):
        selected.append(oid.encode())
raw=subprocess.run([*base,'cat-file','--batch'],input=b'\n'.join(selected)+b'\n',capture_output=True,check=True).stdout
position=0
results=[]
rules={
    'quoted_credential_assignment':re.compile(rb'(?i)(?:password|passwd|client[_-]?secret|api[_-]?key|access[_-]?token|authorization|token)\s*[:=]\s*(?:"[^"\r\n]{16,}"|\x27[^\x27\r\n]{16,}\x27)'),
    'credential_url':re.compile(rb'(?i)(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis)://[^\s:"\x27]+:[^\s@"\x27]+@'),
    'github_workflow_credential':re.compile(rb'(?i)(?:GH_TOKEN|GITHUB_TOKEN|OPENAI_API_KEY|AWS_SECRET_ACCESS_KEY)\s*[:=]\s*[A-Za-z0-9_+/=-]{16,}'),
}
for oid in selected:
    end=raw.index(b'\n',position)
    header=raw[position:end].split()
    size=int(header[-1])
    blob=raw[end+1:end+1+size]
    position=end+1+size+1
    for label,pattern in rules.items():
        hits=list(pattern.finditer(blob))
        if hits:
            path=paths[oid]
            results.append({'object':oid.decode(),'path':path,'rule':label,'count':len(hits),'fixture_or_test_location':'test' in path or path=='backend/guards.py' or '/audit/' in path or 'redteam/' in path,'values_suppressed':True})
result={'unique_blobs_scanned':len(selected),'scope':'All reachable refs including fetched PR3; excludes binary extensions and blobs over2MiB','candidates':results,'limitations':'Heuristic rules; candidate location classification is not validation of credential authenticity.'}
destination=Path(__file__).with_name('reviewer-expanded-secrets.json')
destination.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
print(json.dumps(result,indent=2))
