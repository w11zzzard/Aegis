# AEGIS

### Security, with evidence.

**AEGIS** (Agent Enforcement Gateway for Intelligent Systems) evaluates proposed actions against explicit security policy and records each decision. The dashboard shows the decision and its audit evidence together.

> A working, local prototype for exploring access boundaries around AI agent requests.

## See it in five minutes

Start the backend and dashboard using the instructions below, then open **http://127.0.0.1:5173**.

| Time | Try this | Expected result |
| --- | --- | --- |
| 1 min | Click **Try the live policy check**. Choose **Analyst · restricted portfolio** and evaluate. | **BLOCK** · `portfolio_restricted` |
| 1 min | Choose **Portfolio manager · same resource** and evaluate. | **ALLOW** · `portfolio_restricted` |
| 1 min | Choose **Restricted data · external destination** and evaluate. | **BLOCK** · `external_exfiltration` |
| 1 min | Choose **Synthetic secret · redacted output** and evaluate. | **REDACT** · `output_secrets` |
| 1 min | Click **Inspect audited event** on a result. | Review its matching event ID, decision, policy and reason. |

The audit table starts with the five newest events. Select **Show all events** to expand it. The summary cards show backend data; running the red-team corpus requires a `SECURITY_ADMIN` credential.

## Run the demo

You need **Python 3.12+** and **Node.js 22+**. Open two terminals in the cloned repository.

Clone the project:

```sh
git clone https://github.com/w11zzzard/Aegis.git
cd Aegis
```

### Terminal 1 · Gateway

**Windows PowerShell**

```powershell
py -3.12 -m venv backend/.venv
./backend/.venv/Scripts/python.exe -m pip install -r backend/requirements-lock.txt
$env:AEGIS_PROFILE = 'local-demo'
./backend/.venv/Scripts/python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --no-access-log
```

**macOS / Linux**

```sh
python3.12 -m venv backend/.venv
./backend/.venv/bin/python -m pip install -r backend/requirements-lock.txt
AEGIS_PROFILE=local-demo ./backend/.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --no-access-log
```

### Terminal 2 · Dashboard

```sh
cd frontend
npm ci
npm run dev
```

Open the local address Vite prints, normally **http://127.0.0.1:5173**.

## What the prototype does

- Applies deterministic policy checks to roles, data classifications, destinations, proposed tools and usage limits.
- Returns decisions such as **ALLOW**, **BLOCK**, **REDACT** and **THROTTLE**.
- Shows sanitized audit events with the policy and reason behind each decision.

## Scope and safety

The demo uses synthetic proposals. It does not call a live AI model, access real financial data or execute tools. Its authorization and data-boundary decisions are deterministic; pattern-based output redaction is included. `local-demo` is intended for loopback use only—do not expose it to the public internet or connect it to confidential data. This prototype is not production-ready.

## Checks and technical details

From `frontend/`, run the frontend tests and production build:

```sh
npm test
npm run build
```

For the full security verification, backend setup and deployment limitations, see [backend/README.md](backend/README.md). For the API shape, see [docs/API_CONTRACT.md](docs/API_CONTRACT.md). The active security test suite and review are documented in [backend/SECURITY_REVIEW.md](backend/SECURITY_REVIEW.md).
