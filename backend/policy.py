"""Content-based hot reload. An invalid current file disables evaluation."""

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock

import yaml

from .models import PolicyConfig


class PolicyLoader(yaml.SafeLoader):
    """Reject ambiguous duplicate keys and aliases in this small policy format."""

    def compose_node(self, parent, index):
        if self.check_event(yaml.AliasEvent):
            raise ValueError("Policy aliases are unsupported")
        return super().compose_node(parent, index)

    def construct_mapping(self, node, deep=False):
        mapping = {}
        for key_node, value_node in node.value:
            key = self.construct_object(key_node, deep=deep)
            if key in mapping:
                raise ValueError("Duplicate policy key")
            mapping[key] = self.construct_object(value_node, deep=deep)
        return mapping


def utc_now():
    return datetime.now(timezone.utc).isoformat()


@dataclass(frozen=True)
class PolicySnapshot:
    config: PolicyConfig | None
    digest: str | None


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
                # PolicyLoader derives from SafeLoader and rejects aliases/duplicate keys.
                parsed = yaml.load(raw, Loader=PolicyLoader)  # nosec B506
                config = PolicyConfig.model_validate_json(json.dumps(parsed))
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

    def snapshot(self):
        # Capture both fields under the same lock; callers never consult mutable
        # global digest state to authorize a previously evaluated operation.
        with self.lock:
            config = self.reload()
            return PolicySnapshot(config.model_copy(deep=True) if config else None, self.digest if config else None)
