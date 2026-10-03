"""Content-based hot reload. An invalid current file disables evaluation."""

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock

import yaml

from .models import PolicyConfig


def utc_now():
    return datetime.now(timezone.utc).isoformat()


class PolicyStore:
    def __init__(self, path: Path):
        self.path = path
        self.config = None
        self.digest = None
        self.loaded = False
        self.last_reload = None
        self.lock = RLock()
        self.reload()

    def reload(self):
        with self.lock:
            try:
                with self.path.open("rb") as handle:
                    raw = handle.read(65537)
                if len(raw) > 65536:
                    raise ValueError("Oversized policy")
                digest = hashlib.sha256(raw).hexdigest()
                if digest == self.digest and self.loaded:
                    return self.config
                # JSON validation accepts enum strings while preserving strict types.
                config = PolicyConfig.model_validate_json(json.dumps(yaml.safe_load(raw)))
                self.config = config
                self.digest = digest
                self.loaded = True
                self.last_reload = utc_now()
                return config
            except (OSError, ValueError, TypeError, yaml.YAMLError, RecursionError):
                self.loaded = False
                return None

    def status(self):
        with self.lock:
            self.reload()
            return {
                "loaded": self.loaded,
                "version": self.config.version if self.config else None,
                "rule_count": len(self.config.resources) if self.config else 0,
                "last_reload": self.last_reload,
                "error": None if self.loaded else "Policy unavailable or invalid",
            }
