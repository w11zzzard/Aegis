# AEGIS audit threat model — 4 October 2026

Scope: an isolated working tree rooted at hardened `e52eb5059bba618db768c17353256d9eb516938c`, not a release or production deployment. Original main and contributor worktrees were preserved. Current PR #3 head `c49f1cf07b9e6faf053a5cbdc08c830be0a24da9` was fetched and compared: it contains reporting/integration additions but lacks the hardened branch's authenticated boundary, durable shared state, admission and JSON safeguards. Relevant attack ideas were exercised against this target; no weaker backend was copied.

## Assets and adversaries

Protected assets are configured bearer credentials, catalog authorization/classification, policy integrity, finite request/character allowances, pending approval context, sanitized decision evidence and browser trust in current results. All resources and output in this demo are synthetic. Attackers control HTTP headers, JSON claims, prompt/output/source strings, tool proposals and browser-visible response fixtures. A credential holder can attempt role escalation, cross-user event reads, exfiltration or availability abuse. A local operator who edits YAML/corpus/state has privileged configuration access; corpus ambiguity still must not create false green verification. Operator ACL compromise, arbitrary host code execution and credential theft outside the gateway are outside the tested application boundary.

Trusted sources are operator-owned credential configuration, validated YAML identity/resource registries, server-bound principal and captured policy digest. Body roles, classification, destination claims, forwarded addresses and semantic instructions cannot authorize access. Source strings are inert; no RAG ingestion or semantic classifier exists.

## Routes and trust boundaries

| Route | Input/trust boundary | Output/sink |
| --- | --- | --- |
| GET `/health` | Public liveness; shared admission/host/origin controls | Fixed status only |
| GET `/api/events`, `/api/events/{id}` | Authenticated owner filter; admin global view; bounded limit | Sanitized retained events and sampled rejection evidence |
| GET `/api/stats`, `/api/policies/status`, `/api/redteam/results` | Authenticated admin observer; selectable local-demo reads are simulation | Aggregate counters, validated policy status, sanitized corpus outcomes |
| POST `/api/security/evaluate` | Bounded JSON/schema; verified principal; current catalog/policy | Canonical decision, sanitized permitted output, audit/state |
| POST `/v1/chat/completions` | Same auth/body controls; bounded messages/security context | Fixed offline fixture after same guards; refusal carries no output |
| POST `/api/redteam/run` | Verified admin; ten-second run limit; strict trusted corpus | Pinned-policy isolated results; failures remain visible |
| POST `/api/approvals/{id}` | Verified admin; exact boolean body; original context/digest | Evidence-only resolution with `executed: false`; no grant |

Outer admission precedes host/origin, authentication and body work. Credential lookup chooses server limiter keys; current policy still determines role. Body checks enforce actual 64KiB, ten-second deadline, JSON MIME parity, duplicates, complexity and finite numbers. The evaluator pins config/digest, verifies context/catalog/action/classification, destination and exact tool arguments, reserves bounded shared usage, then handles approval or secret-masked output. Approval resolution rechecks authorization and snapshot binding atomically.

Tools and models never execute. There is no actual downstream URL or data sink, so SSRF redirects/network forwarding and real tool execution are inapplicable. Tests use inert sentinels and observe no downstream invocation. All service tests own fresh loopback ports/state/processes. SQLite supports one host with a shared absolute local-filesystem path; authenticated state failures refuse output. Memory-only local-demo supports one worker and selectable identities are not authentication.

## Audit and browser boundaries

Protected evidence is bounded to 2,000 records, independently of 256 rejection samples and fixed counters/admission keys. Raw prompt/output/source and tool commands are excluded from audit and minimal pending state. It is a durable bounded buffer, not an immutable archive. Configured credentials are recognized by digest/length and bounded substring checks, plus one bounded base64/base64url decoding layer; unknown formats, large encoded containers and recursive encoding remain outside pattern masking.

The dashboard uses in-memory bearer credentials, text rendering, canonical runtime schemas, bounded UTF-8 response streams and sanitized failures. Sensitive raw content/credential/error extras are rejected through a bounded traversal; only permitted canonical sanitized_output is accepted then omitted from the dashboard model. Disconnect/context changes invalidate old asynchronous results; failures clear stale success. Fixture journeys test hostile/malformed responses separately from actual HTTP/browser journeys. This target has no report/download/CSV interface; CSV formula injection is inapplicable and full CP4 reporting remains unfinished. Generic administrative JSON adapters are bounded but not certified as typed reporting schemas.

Production TLS/identity provider/MFA/revocation, ingress/socket limits, operator ACLs, backup/recovery, immutable retention and real data/model/tool integration remain deployment gates. Admission bounds accepted work, not all incoming sockets. Quotas count conservative character units, not model tokens, cost or money. CP2/CP3 semantic requirements need organizer clarification; deterministic regex/pattern masking is not semantic AI.
