"""Bounded API and trusted policy schemas."""

from enum import StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints


class Decision(StrEnum):
    ALLOW = "ALLOW"
    BLOCK = "BLOCK"
    REDACT = "REDACT"
    REQUIRE_APPROVAL = "REQUIRE_APPROVAL"
    THROTTLE = "THROTTLE"


class Classification(StrEnum):
    PUBLIC = "PUBLIC"
    INTERNAL = "INTERNAL"
    CONFIDENTIAL = "CONFIDENTIAL"
    RESTRICTED = "RESTRICTED"


class Role(StrEnum):
    INTERN = "INTERN"
    ANALYST = "ANALYST"
    SENIOR_ANALYST = "SENIOR_ANALYST"
    PORTFOLIO_MANAGER = "PORTFOLIO_MANAGER"
    SECURITY_ADMIN = "SECURITY_ADMIN"


Identifier = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_./:-]{1,128}$")]
Text = Annotated[str, StringConstraints(max_length=16000)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class EvaluateRequest(StrictModel):
    # Missing context reaches the engine and produces a canonical BLOCK event.
    user: Identifier | None = None
    role: Annotated[Role, Field(strict=False)] | None = None
    action: Literal["read", "export"] | None = None
    resource: Identifier | None = None
    classification: Annotated[Classification, Field(strict=False)] | None = None
    destination: Literal["INTERNAL", "EXTERNAL"] | None = None
    request_id: Identifier | None = None
    prompt: Text | None = None
    output: Text | None = None
    tool: Identifier | None = None
    tool_arguments: dict | None = None
    estimated_tokens: Annotated[int, Field(ge=0, le=1000000)] = 0
    model: Identifier | None = None
    source: Text | None = None


class ResourcePolicy(StrictModel):
    classification: Classification
    roles: Annotated[list[Role], Field(min_length=1)]
    actions: Annotated[list[Literal["read", "export"]], Field(min_length=1)]
    approval_actions: list[Literal["read", "export"]] = []
    policy: Identifier


class Budgets(StrictModel):
    window_seconds: Annotated[int, Field(ge=1, le=86400)]
    requests: Annotated[int, Field(ge=1, le=100000)]
    tokens: Annotated[int, Field(ge=1, le=10000000)]


class PolicyConfig(StrictModel):
    version: Identifier
    identities: Annotated[dict[Identifier, Role], Field(min_length=1, max_length=1000)]
    resources: Annotated[dict[Identifier, ResourcePolicy], Field(min_length=1, max_length=1000)]
    budgets: Budgets
