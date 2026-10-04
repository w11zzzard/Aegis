# AEGIS

**A**gent **E**nforcement **G**ateway for **I**ntelligent **S**ystems

AEGIS is a lightweight AI control layer for governing requests between people, AI agents, models, tools, and data. The current backend demo uses deterministic policy enforcement and pattern-based output redaction. Semantic inspection and real model calls are not implemented; authorization and data-boundary decisions remain deterministic.

## Hackathon target

Build and submit a working, locally runnable gateway, configurable policy catalog, security reporting/dashboard, and executable positive and negative tests. The competition submission is due **4 October 2026 at 23:00**. The challenge is open-ended; the brief weights guardrail robustness (30%), architecture/performance (20%), reporting (20%), self-tests (15%), and implementability/scalability (15%).

## Recommended stack

- **Backend and gateway:** Python 3.12+, FastAPI, Pydantic, PyYAML
- **Frontend:** React, TypeScript, Vite
- **Policy and audit state:** versioned YAML for policy; SQLite for durable events and budget counters if persistence is needed
- **Validation:** pytest + FastAPI TestClient; frontend build/typecheck
- **Planned semantic signal:** a local advisory adapter, subject to mentor scope confirmation; not implemented in the demo
- **Collaboration:** GitHub repository, two owner branches, short integration PRs; shared API contract in docs/API_CONTRACT.md

No paid model or external service is required for the demo. Keep the core deterministic and runnable offline.

## The 20-hour delivery order

1. **0–1 h:** repository, app skeleton, shared contract, health check
2. **1–5 h:** identity context, RBAC, YAML policy, deny-by-default evaluation and audit event
3. **5–8 h:** output secret redaction, destination/exfiltration and proposed tool-call guard
4. **8–11 h:** budget/rate enforcement and policy hot reload; adversarial tests
5. **11–15 h:** dashboard event table/details, policy status, stats and real evaluation console
6. **15–17 h:** red-team endpoint and executable test suite; integration fixes
7. **17–19 h:** demo rehearsal, telemetry, architecture diagram, README/runbook
8. **19–20 h:** freeze, verify submission assets, submit before deadline

If time slips, preserve deterministic authorization, exfiltration controls, audit evidence, API integration, tests, and a working demo. Defer semantic models, elaborate charts, and broad protocol compatibility.

## Parallel ownership

- **Developer A — security/backend:** backend/, policies/, redteam/, backend tests. Owns all enforcement and contract implementation.
- **Developer B — dashboard/frontend:** frontend/. Owns API client, canonical TypeScript types, event table/details, dashboard and demo UI.
- **Integrate continuously:** A owns docs/API_CONTRACT.md; B creates a typed adapter if response details differ and flags any proposed contract change first. Avoid simultaneous edits to the same files. Share this repository and push small commits frequently.

First shared milestone: analyst requests restricted portfolio → backend blocks and audits → dashboard renders that real event.

## Local setup

Backend: follow [backend/README.md](backend/README.md) to install locked dependencies, provision credentials and set a shared SQLite state path. The default authenticated profile refuses protected requests until configured. Use `AEGIS_PROFILE=local-demo` only for an explicit loopback simulation.

Frontend: in a second terminal, enter frontend/, install npm dependencies, then run npm run dev.

Never present mocked decisions or invented security metrics as live results. Mark early mock mode visibly and disable it for the final demo.

## Competition submission checklist

- English or Polish submission to HackTribe
- Project title, team name, member list (1–6), description
- PDF presentation of at most 10 slides
- Working gateway/dashboard demo and runnable test suite
- Simple architecture diagram, sample policies, measured performance telemetry
- Submit by **4 October 2026, 23:00** (HackYeah local time)

See docs/ARCHITECTURE_AND_SPRINT.md and docs/API_CONTRACT.md.
