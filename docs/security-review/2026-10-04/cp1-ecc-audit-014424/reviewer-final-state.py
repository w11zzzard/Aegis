"""Pin the independently reviewed final working tree without any Git mutation."""
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import sys

root=Path(sys.argv[1]).resolve()
base=['git','-c','safe.directory='+str(root),'-C',str(root)]
def git(*args):
 return subprocess.run([*base,*args],check=True,capture_output=True).stdout
diff=git('diff','--no-ext-diff','--binary','HEAD')
changed=[name.decode('utf8') for name in git('diff','--name-only','-z','HEAD').split(b'\0') if name]
untracked=[name.decode('utf8') for name in git('ls-files','--others','--exclude-standard','-z').split(b'\0') if name]
hashes={name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in changed+untracked if (root/name).is_file() and (name.startswith(('backend/','frontend/','policies/','redteam/','docs/','.github/')) or name=='README.md')}
result={
 'reviewed_at_warsaw':datetime.now(timezone.utc).astimezone(timezone(timedelta(hours=2))).isoformat(),
 'head':git('rev-parse','HEAD').decode().strip(),
 'branch':git('branch','--show-current').decode().strip(),
 'target_directory':str(root),'verification_kind':'working-tree review and verification; no release/merge certification',
 'tracked_binary_diff_sha256':hashlib.sha256(diff).hexdigest(),
 'changed_tracked_paths':changed,'relevant_untracked_paths':[name for name in untracked if name in hashes],
 'reviewed_changed_and_untracked_sha256':hashes,
 'review_verdict':'No unresolved confirmed critical/high exploit in agreed demo enforcement after encoded-context/full16k fixes; primary full-suite/live evidence and human sign-off remain separate requirements',
 'limitations':['Pattern masker is not arbitrary-secret/DLP or recursive encoding detection','No semantic model/real forwarding/tool execution exists','Local-demo selected identities are not authentication','No disconnected-host runtime test or hosted/proxy deployment test performed by reviewer','Provider/assignment history scan is heuristic','Python dependency lock lacks artifact hashes','Final source mutation requires re-evaluation of source identity and affected verification'],
 'independent_evidence':['reviewer-large-encoded-after.json','reviewer-encoded-after.json','reviewer-final-probes.json','reviewer-corpus-nonfinite-after.json','reviewer-frontend-probes.json','reviewer-focused-tests.json','reviewer-focused-final-tests.json','reviewer-dependency-verification.json','reviewer-baseline.json','reviewer-expanded-secrets.json','reviewer-harness-review.json'],
}
destination=Path(__file__).with_name('reviewer-final-state.json')
destination.write_text(json.dumps(result,indent=2)+'\n',encoding='utf8')
print(json.dumps(result,indent=2))
