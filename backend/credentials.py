"""Generate independent local credentials without logging their values."""

import json
import os
import secrets
from pathlib import Path

from .policy import PolicyStore


def main():
    root = Path(__file__).resolve().parent.parent
    policy = PolicyStore(Path(os.getenv("AEGIS_POLICY_PATH", root / "policies/default.yaml"))).snapshot()
    if not policy.config:
        raise SystemExit("Valid policy required to provision credentials")
    path = root / ".aegis/credentials.json"
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if os.name != "nt" and (path.parent.stat().st_mode & 0o077 or path.parent.stat().st_uid != os.getuid()):
        raise SystemExit("Credential directory must be private to its operator (mode 0700)")
    # Exclusive create prevents accidental rotation or overwriting operator work.
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        json.dump({user: secrets.token_urlsafe(32) for user in policy.config.identities}, handle, indent=2)
    print("Created .aegis/credentials.json. Keep it private; share only each user's own credential.")


if __name__ == "__main__":
    main()
