"""Independent variants of recoverable synthetic administrator-token output/audit."""
import base64
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
sys.path.insert(0,sys.argv[1])
from fastapi.testclient import TestClient
from backend.main import create_app
out=Path(__file__).resolve().parent
manager,admin='M'*48,'S'*48
cases={
 'padded-punctuation':base64.b64encode((admin+'.').encode()).decode(),
 'unpadded-prefix':base64.urlsafe_b64encode(('Synthetic prefix '+admin).encode()).decode().rstrip('='),
 'unpadded-suffix':base64.urlsafe_b64encode((admin+' synthetic suffix').encode()).decode().rstrip('='),
 'url-identifier-context':base64.urlsafe_b64encode(('/metadata/'+admin+':correlation').encode()).decode().rstrip('='),
 'larger-once-encoded-context':base64.urlsafe_b64encode(('Synthetic padding. '*60+admin).encode()).decode().rstrip('='),
 'benign-encoded-control':base64.b64encode(b'ordinary synthetic prose').decode(),
}
rows=[]
for name,encoded in cases.items():
 with tempfile.TemporaryDirectory(prefix='aegis-reviewer-encoded-') as temporary:
  app=create_app(profile='authenticated',auth_tokens={'manager_1':manager,'security_admin_1':admin},state_path=Path(temporary)/'synthetic.sqlite3')
  body={'action':'read','resource':'portfolio/current_positions','classification':'RESTRICTED','destination':'INTERNAL','output':encoded}
  if len(encoded)<=128 and '=' not in encoded: body['request_id']=encoded
  with TestClient(app,base_url='http://localhost',client=('127.0.0.1',50000)) as client:
   headers={'Authorization':'Bearer '+manager}
   response=client.post('/api/security/evaluate',json=body,headers=headers)
   result=response.json()
   event=client.get('/api/events/'+result['event_id'],headers=headers)
   feed=client.get('/api/events',headers=headers)
  with closing(sqlite3.connect(app.state.gateway.store.path)) as db:
   state=db.execute('SELECT body FROM gateway_state').fetchone()[0]
  rows.append({'name':name,'encoded_chars':len(encoded),'status':response.status_code,'decision':result['decision'],'recoverable_output_retained':encoded in result.get('sanitized_output',''),'recoverable_detail_retained':encoded in event.text,'recoverable_feed_retained':encoded in feed.text,'recoverable_state_retained':encoded in state,'metadata_case':'request_id' in body,'raw_synthetic_credential_absent':admin not in response.text+event.text+feed.text+state})
destination=out/(sys.argv[2] if len(sys.argv)>2 else 'reviewer-encoded-before.json')
destination.write_text(json.dumps(rows,indent=2)+'\n',encoding='utf8')
print(json.dumps(rows,indent=2))
