"""Compare each application lock entry with installed metadata without changing environments."""
import importlib.metadata
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
rows = []
for line in (ROOT / "backend/requirements-lock.txt").read_text().splitlines():
    if "==" not in line:
        continue
    name, expected = line.split("==")
    installed = importlib.metadata.version(name)
    rows.append({"package": name, "locked": expected, "installed": installed, "matches": expected == installed})
print(json.dumps({"python": rows}, indent=2))
