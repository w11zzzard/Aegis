"""Check invalid JSON constants cannot become green corpus evidence."""
import json
from pathlib import Path
import sys
import tempfile
sys.path.insert(0,sys.argv[1])
from fastapi.testclient import TestClient
from backend.main import create_app
rows=[]
for scalar in ['NaN','Infinity','-Infinity','1e999']:
 with tempfile.TemporaryDirectory(prefix='aegis-reviewer-nonfinite-') as temporary:
  corpus=Path(temporary)/'invalid.json'
  corpus.write_text('{"cases":[{"id":"invalid-scalar","expected":"BLOCK","request":{"user":"manager_1","role":"PORTFOLIO_MANAGER","action":"read","resource":"portfolio/current_positions","classification":"RESTRICTED","destination":"INTERNAL","tool":"shell","tool_arguments":{"command":'+scalar+'}}}]}',encoding='utf8')
  app=create_app(profile='authenticated',auth_tokens={'security_admin_1':'S'*48},state_path=Path(temporary)/'synthetic.sqlite3')
  app.state.redteam.corpus_path=corpus
  with TestClient(app,base_url='http://localhost',client=('127.0.0.1',50000)) as client:
   headers={'Authorization':'Bearer '+'S'*48}
   response=client.post('/api/redteam/run',headers=headers,json={})
   result=client.get('/api/redteam/results',headers=headers).json()
   rows.append({'scalar':scalar,'status':response.status_code,'persisted_status':result.get('status'),'total':result.get('total'),'passed':result.get('passed'),'cache_control':response.headers.get('cache-control'),'refused_not_green':response.status_code==503 and result.get('status')=='failed'})
destination=Path(__file__).with_name(sys.argv[2])
destination.write_text(json.dumps(rows,indent=2)+'\n',encoding='utf8')
print(json.dumps(rows,indent=2))
