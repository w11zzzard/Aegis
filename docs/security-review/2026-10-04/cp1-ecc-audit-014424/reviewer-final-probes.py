"""Different bypass probes for the changed guards and corpus; sanitized evidence."""
import base64
from contextlib import closing
import hashlib
import json
from pathlib import Path
import sys
import tempfile
from time import perf_counter
from unittest.mock import patch
sys.path.insert(0,sys.argv[1])
from fastapi.testclient import TestClient
from backend.guards import CredentialRedactor,redact_secrets
from backend.main import create_app

out=Path(__file__).resolve().parent
rows=[]
with tempfile.TemporaryDirectory(prefix='aegis-reviewer-corpus-') as temporary:
 app=create_app(profile='authenticated',auth_tokens={'security_admin_1':'S'*48},state_path=Path(temporary)/'synthetic.sqlite3')
 corpus=Path(temporary)/'duplicate-escaped.json'
 # Unicode-escaped spelling reaches the same decoded key as literal spelling.
 corpus.write_text('{"cases":[{"id":"escaped","expected":"BLOCK","\\u0065xpected":"ALLOW","request":{"user":"manager_1","role":"PORTFOLIO_MANAGER","action":"read","resource":"portfolio/current_positions","classification":"RESTRICTED","destination":"INTERNAL"}}]}',encoding='utf8')
 app.state.redteam.corpus_path=corpus
 with TestClient(app,base_url='http://localhost',client=('127.0.0.1',50000)) as client:
  headers={'Authorization':'Bearer '+'S'*48}
  response=client.post('/api/redteam/run',json={},headers=headers)
  persisted=client.get('/api/redteam/results',headers=headers)
  rows.append({'name':'unicode-escaped-duplicate-corpus-key','status':response.status_code,'persisted_status':persisted.json().get('status'),'reported_total':persisted.json().get('total'),'no_green_result':response.status_code==503 and persisted.json().get('status')=='failed','cache_control':response.headers.get('cache-control')})

tokens={hashlib.sha256(('a'*length).encode()).digest():length for length in range(32,257)}
redactor=CredentialRedactor(tokens)
ordinary=hashlib.sha256
for name,value in {
 'max_plain_opaque':'u'*16000,
 'encoded_opaque_chunks':' '.join([base64.b64encode(('u'*740).encode()).decode()]*16)[:16000],
 'encoded_with_binary_looking_separators':' '.join([base64.b64encode(('~'*30+'u'*680+'?').encode()).decode()]*16)[:16000],
 'benign_small_text':'ordinary synthetic prose',
}.items():
 count=[0]
 def counted(value):
  count[0]+=1
  return ordinary(value)
 started=perf_counter()
 with patch('backend.guards.hashlib.sha256',counted):
  opaque,changed=redactor.redact(value)
  masked,patterned=redact_secrets(opaque,known_secret=redactor.matches)
 rows.append({'name':name,'chars':len(value),'sha256_comparisons':count[0],'elapsed_ms':round((perf_counter()-started)*1000,3),'masked':changed or patterned,'remaining_chars':len(masked)})

destination=out/'reviewer-final-probes.json'
destination.write_text(json.dumps(rows,indent=2)+'\n',encoding='utf8')
print(json.dumps(rows,indent=2))
