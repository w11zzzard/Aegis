"""Independent owned synthetic HTTP and source/history audit; never print secrets."""
import base64
import hashlib
import importlib.metadata
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile

TARGET = Path(sys.argv[1]).resolve()
OUT = Path(__file__).resolve().parent
sys.path.insert(0, str(TARGET))
from fastapi.testclient import TestClient
from backend.main import create_app

def git(*args):
    return subprocess.run(['git', '-c', 'safe.directory='+str(TARGET), '-C', str(TARGET), *args], check=True, capture_output=True).stdout

def challenge(name, output, *, profile='authenticated', route='evaluate', classification='RESTRICTED'):
    manager = 'M' * 48
    with tempfile.TemporaryDirectory(prefix='aegis-cp1-reviewer-') as folder:
        app = create_app(profile=profile, auth_tokens={'manager_1': manager}, state_path=Path(folder)/'synthetic.sqlite3')
        body = {'action':'read','resource':'portfolio/current_positions','classification':classification,'destination':'INTERNAL','output':output}
        if profile == 'local-demo':
            body.update(user='manager_1', role='PORTFOLIO_MANAGER')
        if route == 'chat':
            body = {'messages':[{'role':'user','content':output}], 'security':body}
        path = '/v1/chat/completions' if route == 'chat' else '/api/security/evaluate'
        with TestClient(app, base_url='http://localhost', client=('127.0.0.1', 50000), raise_server_exceptions=False) as client:
            response = client.post(path, content=json.dumps(body).encode('ascii'), headers={'Authorization':'Bearer '+manager,'Content-Type':'application/json'})
            content = response.json() if response.headers.get('content-type','').startswith('application/json') else {}
            events = client.get('/api/events', headers={'Authorization':'Bearer '+manager})
            return {'name':name,'profile':profile,'route':path,'status':response.status_code,'decision':content.get('decision',content.get('aegis',{}).get('decision')),'policy':content.get('policy'),'cache_control':response.headers.get('cache-control'),'response_secret_present':manager in response.text,'encoded_secret_present':base64.b64encode((manager+'.').encode()).decode() in response.text,'response_output_retained':output in content.get('sanitized_output','') if output else False,'event_status':events.status_code,'events_secret_present':manager in events.text,'retained_events':len(app.state.gateway.events)}

def dependency_inventory():
    result=[]
    for line in (TARGET/'backend/requirements-lock.txt').read_text().splitlines():
        if '==' not in line: continue
        name, locked = line.split('==')
        try: installed=importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError: installed=None
        result.append({'package':name,'locked':locked,'installed':installed,'matches':locked==installed})
    lock=json.loads((TARGET/'frontend/package-lock.json').read_text())
    return {'python':result,'frontend_locked':{path:node.get('version') for path,node in lock['packages'].items() if path and node.get('version')}}

def secrets_audit():
    # Public fixture rules recognized by location/text; candidates reported by path/count only.
    patterns=[re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),re.compile(rb'\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{24,}|AKIA[A-Z0-9]{16}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[baprs]-[A-Za-z0-9-]{20,})\b')]
    files=[s.decode('utf-8') for s in git('ls-files','-z').split(b'\0') if s]
    commits=git('rev-list','--all').splitlines()
    rows=[]
    for revision in [b'HEAD',*commits]:
        # Scan tracked snapshots via Git, no working env/credential file access.
        names=[s.decode('utf-8') for s in git('ls-tree','-r','--name-only','-z',revision.decode()).split(b'\0') if s]
        for path in names:
            if path.endswith(('.png','.jpg','.jpeg','.webp','.pdf','.woff','.woff2')): continue
            blob=git('show',revision.decode()+':'+path)
            count=sum(len(p.findall(blob)) for p in patterns)
            if count:
                fixture=('/tests/' in '/'+path or '/audit/' in '/'+path or 'redteam/' in path or path in {'backend/guards.py'} or 'security-review/' in path or 'test' in Path(path).name)
                rows.append({'revision':revision.decode(),'path':path,'candidate_count':count,'fixture_or_test_location':fixture})
    return {'tracked_file_count':len(files),'history_commit_count':len(commits),'rules':'private-key markers and known token provider shapes; no candidate text emitted','candidates':rows,'limitations':'Pattern scan cannot prove absence of arbitrary opaque/encoded credentials; fixtures require source review.'}

if __name__ == '__main__':
    credential='M'*48
    cases=[challenge('benign-control','ordinary synthetic prose'), challenge('unpaired-surrogate-output','\ud800'), challenge('unpaired-surrogate-output-local','\udfff',profile='local-demo'), challenge('unpaired-surrogate-chat','\ud800',route='chat'), challenge('configured-credential-one-layer-with-punctuation',base64.b64encode((credential+'.').encode()).decode()),challenge('configured-credential-one-layer-with-prose',base64.b64encode(('Synthetic value: '+credential).encode()).decode()),challenge('configured-credential-one-layer-exact',base64.b64encode(credential.encode()).decode())]
    (OUT/'reviewer-http-challenges.json').write_text(json.dumps(cases,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'challenges':cases},indent=2), flush=True)
    result={'head':git('rev-parse','HEAD').decode().strip(),'challenges':cases,'inventory':dependency_inventory(),'secret_audit':secrets_audit()}
    destination=OUT/'reviewer-baseline.json'
    destination.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'evidence':str(destination),'challenges':cases,'dependency_matches':all(row['matches'] for row in result['inventory']['python']),'secret_candidate_records':len(result['secret_audit']['candidates'])},indent=2))
