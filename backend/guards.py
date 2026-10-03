"""No model or proposed tool is executed here."""

import re


SECRET_PATTERNS = (
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----.*?(?:-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|$)", re.S),
    re.compile(r"\b(?:sk-[A-Za-z0-9_-]{8,}|AKIA[A-Z0-9]{16}|gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|xox[baprs]-[A-Za-z0-9-]{10,})\b"),
    re.compile(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b"),
    re.compile(r"(?i)(?:[\"']?\b(?:password|passwd|pwd|api[_-]?key|access[_-]?token|client[_-]?secret|authorization)[\"']?\s*[:=]\s*)(?:\"[^\"\r\n]*\"|'[^'\r\n]*'|[^\s,;}]+(?:\s+[A-Za-z0-9._-]+)?)"),
    re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._-]+"),
    re.compile(r"(?i)\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?)://[^\s]+"),
)


def redact_secrets(value: str):
    result = value
    for pattern in SECRET_PATTERNS:
        result = pattern.sub("[REDACTED]", result)
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
