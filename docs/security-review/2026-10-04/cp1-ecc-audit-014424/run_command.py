"""Capture this run's commands and exit codes without recording credentials."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
from datetime import datetime, timedelta, timezone

p = argparse.ArgumentParser()
p.add_argument("--name", required=True)
p.add_argument("--cwd", required=True)
p.add_argument("command", nargs=argparse.REMAINDER)
args = p.parse_args()
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
command = args.command[1:] if args.command[:1] == ["--"] else args.command
root = Path(__file__).resolve().parent
# Warsaw is UTC+02 on this run's date, 2026-10-04; no tzdata install needed.
now = lambda: datetime.now(timezone(timedelta(hours=2), "Europe/Warsaw")).isoformat()
started = now()
log = root / (args.name + ".log")
with log.open("w", encoding="utf-8") as out:
    result = subprocess.run(command, cwd=args.cwd, stdout=out, stderr=subprocess.STDOUT, text=True)
manifest = {"command": command, "cwd": args.cwd, "started_warsaw": started, "ended_warsaw": now(), "exit_code": result.returncode, "log": log.name}
(root / (args.name + "-command.json")).write_text(json.dumps(manifest, indent=2), encoding="utf-8")
print(json.dumps(manifest, indent=2))
print("\n".join(log.read_text(encoding="utf-8", errors="replace").splitlines()[-28:]))
sys.exit(result.returncode)
