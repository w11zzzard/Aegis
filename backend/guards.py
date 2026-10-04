"""No model or proposed tool is executed here."""

import re
import base64
import binascii
import hashlib


SECRET_PATTERNS = (
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----.*?(?:-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|$)", re.S),
    re.compile(r"\b(?:sk-[A-Za-z0-9_-]{8,}|(?:AKIA|ASIA)[A-Z0-9]{16}|gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|xox[baprs]-[A-Za-z0-9-]{10,})\b"),
    re.compile(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b"),
    re.compile(r"(?i)(?:[\"']?\b(?:password|passwd|pwd|api[_-]?key|access[_-]?token|client[_-]?secret|authorization)[\"']?\s*[:=]\s*)(?:\"[^\"\r\n]*\"|'[^'\r\n]*'|[^\s,;}]+(?:\s+[A-Za-z0-9._-]+)?)"),
    re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._-]+"),
    re.compile(r"(?i)\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?)://[^\s]+"),
)


class CredentialRedactor:
    """Recognize configured opaque credentials by digest, with bounded work.

    Only digest/length pairs remain in memory. If a value needs too many
    substring comparisons, conservatively mask that whole value.
    """

    MAX_COMPARISONS = 32768

    def __init__(self, credentials=()):
        self.credentials = dict(credentials)
        self.lengths = sorted(set(self.credentials.values()), reverse=True)

    def matches(self, value):
        # Decoded prose may contain the credential rather than equal it. Reuse
        # the bounded substring search, including its conservative fallback.
        return self.redact(value)[1]

    def redact(self, value):
        if not self.credentials:
            return value, False
        spans = []
        comparisons = 0
        for run in re.finditer(r"[A-Za-z0-9_-]{32,}", value):
            raw = run.group().encode("ascii")
            offset = 0
            while offset <= len(raw) - 32:
                matched = False
                for length in self.lengths:
                    if offset + length > len(raw):
                        continue
                    comparisons += 1
                    if comparisons > self.MAX_COMPARISONS:
                        return "[REDACTED]", True
                    digest = hashlib.sha256(raw[offset:offset + length]).digest()
                    if self.credentials.get(digest) == length:
                        spans.append((run.start() + offset, run.start() + offset + length))
                        offset += length
                        matched = True
                        break
                if not matched:
                    offset += 1
        result = value
        for start, end in reversed(spans):
            result = result[:start] + "[REDACTED]" + result[end:]
        return result, bool(spans)


def redact_secrets(value: str, known_secret=None):
    result = value
    for pattern in SECRET_PATTERNS:
        result = pattern.sub("[REDACTED]", result)
    # One decoding layer covers the full permitted 16KiB API text field. This
    # remains a pattern masker, not an arbitrary secret or content classifier.
    def encoded_secret(match):
        token = match.group(0)
        try:
            decoded = base64.b64decode(token + "=" * (-len(token) % 4), altchars=b"-_", validate=True).decode("utf-8")
        except (ValueError, UnicodeError, binascii.Error):
            return token
        recognized = any(pattern.search(decoded) for pattern in SECRET_PATTERNS)
        if known_secret is not None:
            recognized = recognized or known_secret(decoded)
        return "[REDACTED]" if recognized else token
    result = re.sub(r"(?<![A-Za-z0-9+/_-])[A-Za-z0-9+/_-]{12,16000}={0,2}(?![A-Za-z0-9+/_-])", encoded_secret, result)
    return result, result != value


def tool_problem(request):
    if request.tool is None:
        return "Tool arguments without a proposed tool" if request.tool_arguments is not None else None
    # Exact schema and allowlist. Arguments never reach a shell, filesystem or HTTP client.
    if request.tool not in {"read_resource", "export_resource"}:
        return "Proposed tool is not allowlisted"
    arguments = request.tool_arguments
    if not isinstance(arguments, dict) or set(arguments) != {"resource", "destination"}:
        return "Malformed or unsupported proposed tool arguments"
    if arguments["resource"] != request.resource:
        return "Proposed tool resource differs from evaluated resource"
    if arguments["destination"] != request.destination:
        return "Proposed tool destination differs from evaluated destination"
    required_action = "read" if request.tool == "read_resource" else "export"
    if request.action != required_action:
        return "Proposed tool action differs from evaluated action"
    return None
