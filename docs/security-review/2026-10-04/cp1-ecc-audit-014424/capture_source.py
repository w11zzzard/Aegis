"""Final working-tree identity; excludes generated outputs and dependencies."""
import hashlib
import json
from pathlib import Path
import subprocess
from datetime import datetime, timezone, timedelta

SOURCE = Path(r"C:\Users\admin\.codex\worktrees\aegis-security-cp1\Hackyeah 2026 goldman")
REPORT = Path(__file__).resolve().parent
def git(*args):
    return subprocess.check_output(["git", *args], cwd=SOURCE, stderr=subprocess.DEVNULL)
sha = lambda raw: hashlib.sha256(raw).hexdigest()
tracked = git("ls-files", "-z").decode().split("\0")
new = git("ls-files", "--others", "--exclude-standard", "-z").decode().split("\0")
relevant_new = [name for name in new if name and name.split("/")[0] in {"backend", "frontend", "policies", "redteam", "docs"}]
files = sorted({name for name in tracked + relevant_new if name and (SOURCE / name).is_file()})
hashes = {name: sha((SOURCE / name).read_bytes()) for name in files}
patch = git("diff", "--binary", "HEAD")
(REPORT / "working-tree.patch").write_bytes(patch)
state = {
    "kind": "working-tree verification; no release/merge certification",
    "recorded_warsaw": datetime.now(timezone(timedelta(hours=2))).isoformat(),
    "directory": str(SOURCE), "head": git("rev-parse", "HEAD").decode().strip(),
    "branch": git("branch", "--show-current").decode().strip() or "detached",
    "status": git("status", "--short").decode().splitlines(),
    "tracked_diff_sha256": sha(patch), "patch": "working-tree.patch",
    "source_fingerprint_sha256": sha(json.dumps(hashes, sort_keys=True, separators=(",", ":")).encode()),
    "file_sha256": hashes,
    "relevant_untracked_source_sha256": {name: hashes[name] for name in relevant_new},
    "generated_untracked_excluded": [name for name in new if name and name not in relevant_new],
    "baseline": {
        "isolated_head": "e52eb5059bba618db768c17353256d9eb516938c",
        "original_checkout_head": "4e9a3ecbac6d685d49a6685635a9f58debefd787",
        "original_checkout_branch": "main", "original_tracked_edits_at_start": "none",
        "contributor_worktrees_and_untracked_reports": "preserved; original plan updated by append only",
        "current_pr3_ref": "refs/codex/security-cp1/pr3-head",
        "current_pr3_head": "c49f1cf07b9e6faf053a5cbdc08c830be0a24da9",
        "historical_plan_head": "141490f4df1cf4ee296b808626501f0dc9f2743b",
        "target_choice": "Continued recommended hardened e52 target after optional clarification received no answer; PR3 diff reviewed separately",
        "baseline_detail": "reviewer-baseline.json",
    },
}
(REPORT / "source-identity.json").write_text(json.dumps(state, indent=2), encoding="utf-8")
for name in ["frontend-real-browser-verification.json", "frontend-offline-browser-verification.json", "backend-live-020850_626488-results.json"]:
    evidence = json.loads((REPORT / name).read_text(encoding="utf-8"))
    tested = evidence.get("sourceHashes", evidence.get("source_file_sha256", {}))
    mismatches = [file for file, value in tested.items() if hashes.get(file) != value]
    assert not mismatches, (name, mismatches)
print(json.dumps({key: state[key] for key in ["head", "tracked_diff_sha256", "source_fingerprint_sha256", "branch"]}, indent=2))
print("All live/browser source hashes match final files; relevant new source files:", len(relevant_new))
