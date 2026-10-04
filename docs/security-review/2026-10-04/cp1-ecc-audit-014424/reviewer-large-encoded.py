"""Full API-sized one-layer credential masking and benign work-bound controls."""
import base64
from contextlib import closing
import hashlib
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
from time import perf_counter
from unittest.mock import patch
sys.path.insert(0,sys.argv[1])
from fastapi.testclient import TestClient
from backend.guards import CredentialRedactor,redact_secrets
from backend.main import create_app
manager,admin='M'*48,'S'*48
variants={
 'large-supported-secret':('Synthetic padding. '*60+admin,True),
 'near-api-limit-secret':('u'*11950+admin,True),
 'near-api-limit-benign':('u'*11998,False),
 'large-benign-prose':('ordinary synthetic prose. '*400,False),
}
rows=[]
for name,(decoded,contains_secret) in variants.items():
 encoded=base64.urlsafe_b64encode(decoded.encode()).decode()
 assert len(encoded)<=16000
 with tempfile.TemporaryDirectory(prefix='aegis-reviewer-large-') as temporary:
  app=create_app(profile='authenticated',auth_tokens={'manager_1':manager,'security_admin_1':admin},state_path=Path(temporary)/'synthetic.sqlite3')
  with TestClient(app,base_url='http://localhost',client=('127.0.0.1',50000)) as client:
   response=client.post('/api/security/evaluate',headers={'Authorization':'Bearer '+manager},json={'action':'read','resource':'portfolio/current_positions','classification':'RESTRICTED','destination':'INTERNAL','output':encoded})
  result=response.json()
  with closing(sqlite3.connect(app.state.gateway.store.path)) as db:
   state=db.execute('SELECT body FROM gateway_state').fetchone()[0]
  retained=encoded==result.get('sanitized_output')
  rows.append({'name':name,'encoded_chars':len(encoded),'status':response.status_code,'decision':result.get('decision'),'encoded_output_retained':retained,'encoded_state_retained':encoded in state,'passed':response.status_code==200 and result.get('decision')==('REDACT' if contains_secret else 'ALLOW') and retained is not contains_secret})

ordinary=hashlib.sha256
for name,credentials in [('one_credential_length',{ordinary(admin.encode()).digest():48}),('all_225_lengths',{ordinary(('a'*length).encode()).digest():length for length in range(32,257)})]:
 redactor=CredentialRedactor(credentials)
 value=base64.urlsafe_b64encode(('u'*11998).encode()).decode()
 count=[0]
 def counted(value):
  count[0]+=1;return ordinary(value)
 started=perf_counter()
 with patch('backend.guards.hashlib.sha256',counted):
  opaque,changed=redactor.redact(value)
  result,patterned=redact_secrets(opaque,known_secret=redactor.matches)
 rows.append({'name':'work_bound_'+name,'encoded_chars':len(value),'sha256_comparisons':count[0],'elapsed_ms':round((perf_counter()-started)*1000,3),'masked':changed or patterned,'finite_runtime':perf_counter()-started<1})
destination=Path(__file__).with_name(sys.argv[2])
destination.write_text(json.dumps(rows,indent=2)+'\n',encoding='utf8')
print(json.dumps(rows,indent=2))
if any(row.get('passed') is False or row.get('finite_runtime') is False for row in rows):
 raise SystemExit(1)
