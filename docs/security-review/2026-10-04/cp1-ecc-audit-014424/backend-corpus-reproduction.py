"""Compare the immutable e52 corpus runner with the working-tree refusal."""
import hashlib
import json
import subprocess
import sys
import tempfile
import types
from datetime import datetime, timedelta, timezone
from pathlib import Path

from backend.core import Gateway
from backend.redteam import RedteamRunner
from backend.tests.test_redteam_integrity import MANAGER, ambiguous_corpora


source = Path(sys.argv[1]).resolve()
report = Path(__file__).resolve().parent
baseline = "e52eb5059bba618db768c17353256d9eb516938c"
raw_source = subprocess.check_output(["git", "show", baseline + ":backend/redteam.py"], cwd=source)
module = types.ModuleType("backend.redteam_baseline")
module.__package__ = "backend"
exec(compile(raw_source, baseline + ":backend/redteam.py", "exec"), module.__dict__)
cases = list(zip(("duplicate expectation", "duplicate request", "duplicate cases", "duplicate tool argument"), ambiguous_corpora()))
for number in ("NaN", "Infinity", "-Infinity", "1e400"):
    request = json.dumps(MANAGER)[:-1]
    raw = ('{"cases":[{"id":"nonfinite","expected":"BLOCK","request":' + request
           + ',"tool":"read_resource","tool_arguments":{"resource":"portfolio/current_positions",'
           + '"destination":"INTERNAL","unexpected":' + number + '}}}]}')
    cases.append(("nonfinite " + number, raw))
rows = []
with tempfile.TemporaryDirectory(prefix="backend-corpus-owned-", dir=report) as directory:
    temp = Path(directory).resolve()
    assert temp.is_relative_to(report)
    for name, raw in cases:
        corpus = temp / "corpus.json"
        corpus.write_text(raw, encoding="utf-8")
        old = module.RedteamRunner(Gateway(source / "policies/default.yaml"), corpus).run()
        assert (old["status"], old["passed"], old["failed"]) == ("completed", 1, 0)
        try:
            RedteamRunner(Gateway(source / "policies/default.yaml"), corpus).run()
        except ValueError as error:
            refusal = type(error).__name__ + ": " + str(error)
        else:
            raise AssertionError("Fixed corpus runner must refuse " + name)
        rows.append({"case": name, "raw_sha256": hashlib.sha256(raw.encode()).hexdigest(),
                     "baseline": {key: old[key] for key in ("status", "total", "passed", "failed", "unexpected_allows")},
                     "fixed": {"refused": True, "error": refusal}})
result = {
    "timestamp": datetime.now(timezone(timedelta(hours=2), "Europe/Warsaw")).isoformat(),
    "baseline_commit": baseline, "baseline_runner_sha256": hashlib.sha256(raw_source).hexdigest(),
    "working_tree_runner_sha256": hashlib.sha256((source / "backend/redteam.py").read_bytes()).hexdigest(),
    "scope": "isolated immutable baseline corpus runner loaded from git; unchanged authorization engine and committed policy; visible API failed-state tested separately",
    "cases": rows,
}
(report / "backend-corpus-reproduction.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
print(json.dumps({"cases": len(rows), "baseline_completed_green": len(rows), "fixed_refusals": len(rows)}))
