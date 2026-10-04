"""Combine final component evidence and assert unchanged tested source hashes."""
import hashlib
import json
from pathlib import Path
import subprocess
from datetime import datetime, timezone, timedelta

REPORT = Path(__file__).resolve().parent
read = lambda name: json.loads((REPORT / name).read_text(encoding="utf-8-sig"))
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
source = read("source-identity.json")
checkout = Path(source["directory"])
diff = subprocess.check_output(["git", "diff", "--binary", "HEAD"], cwd=checkout, stderr=subprocess.DEVNULL)
assert hashlib.sha256(diff).hexdigest() == source["tracked_diff_sha256"]
assert all(sha(checkout / file) == value for file, value in source["file_sha256"].items())
backend = read("backend-VERIFICATION.json")
frontend = read("frontend-VERIFICATION.json")
dependency = read("reviewer-dependency-verification.json")
live = read("backend-live-020850_626488-results.json")
normal = read("frontend-real-browser-verification.json")
guarded = read("frontend-offline-browser-verification.json")
assert live["status"] == "passed" and live["all_owned_processes_stopped"]
assert normal["sourceHashes"] == guarded["sourceHashes"]
assert normal["browserResponsesIntercepted"] is False and not normal["offlineGuard"]["enabled"]
assert guarded["offlineGuard"]["enabled"] and len(guarded["offlineGuard"]["pythonGuardProbes"]) == 4
assert all(item["stopped"] for record in (normal, guarded) for item in record["cleanup"]["ownedProcesses"])
coverage = read("backend-coverage-acceptance.json")["totals"]["percent_covered"]
primary_names = ["backend-acceptance", "backend-demo-acceptance", "frontend-typecheck-acceptance", "frontend-build-verified", "bandit-acceptance"]
primary = [read(name + "-command.json") for name in primary_names]
assert all(row["exit_code"] == 0 for row in primary)
plan = Path(r"C:\Users\admin\Documents\ChatGPT\Hackyeah 2026 goldman\docs\AEGIS_DELIVERY_PLAN.md")
now = datetime.now(timezone(timedelta(hours=2))).isoformat()
files = sorted(path.name for path in REPORT.iterdir() if path.is_file() and path.name != "VERIFICATION.json")
manifest = {
    "recorded_warsaw": now, "timezone": "Europe/Warsaw (UTC+02 on run date)",
    "source": source,
    "checkpoint_record": {"path": str(plan), "sha256": sha(plan), "update": "append-only working record; historical checklists and human gates preserved"},
    "verdict": {
        "cp1_technical_readiness": "ready for reviewed deterministic synthetic demo controls",
        "unresolved_confirmed_critical_high_in_tested_scope": 0,
        "human_a_b_signoff": "pending", "release_merge_production_certification": False,
        "commit_push_merge_deploy_submission_performed_in_this_audit": False,
        "scope": "isolated hardened e52 working tree, not original main/current PR3",
    },
    "results": {
        "backend": {"passed": 427, "statement_coverage": round(coverage, 2), "gate": 80, "log": "backend-acceptance.log", "coverage": "backend-coverage-acceptance.json"},
        "frontend": frontend["results"],
        "actual_http": {"cases": len(live["cases"]), "fresh_services": 5, "status": live["status"], "report": "backend-live-020850_626488-results.json"},
        "default_corpus": {"total": 16, "passed": 16, "unexpected_allows": 0},
        "weakened_disposable_policy": {"passed": 15, "failed": 1, "unexpected_allows": 1, "evidence": "backend-live-020850_626488-results.json"},
        "normal_browser": {"report": "frontend-real-browser-verification.json", "api_responses_intercepted": False, "requests_routed": False, "unexpected_errors": 0, "external_requests": 0},
        "guarded_runtime": {"report": "frontend-offline-browser-verification.json", "mode": "separate simulation of external-network unavailability", "self_probes": "external browser.invalid aborted before outbound; four Python children reject DNS/connect before imports", "api_response_fulfillment": False, "host_globally_disconnected": False, "offline_installation": False},
        "independent_review": {"focused_tests": 37, "different_frontend_probes": 7, "source_review": "reviewer-final-state.json", "harness_review": "reviewer-harness-review.json", "report": "reviewer-independent-review.md"},
        "bandit": {"runtime_findings": len(read("bandit-acceptance.json")["results"]), "report": "bandit-acceptance.json"},
    },
    "commands": {"primary_final": primary, "backend_owned": backend["commands"], "frontend": frontend["commands"], "dependency_checks": dependency},
    "component_manifests": {"backend": "backend-VERIFICATION.json", "frontend": "frontend-VERIFICATION.json", "reviewer": "reviewer-final-state.json"},
    "environment": {
        "os": "Windows, PowerShell", "python": backend["runtime"], "node_application_checks": "24.19.0", "node_advisory_inventory": "22.22.0", "chrome": normal["browser"],
        "prerequisites": "exact installed Python lock and npm nonoptional versions verified; reused read-only environment/node_modules junction; no installation claim",
        "pytest_final_environment": {"PYTHONPATH": str(checkout), "PYTEST_DISABLE_PLUGIN_AUTOLOAD": "1", "PYTHONDONTWRITEBYTECODE": "1", "coverage_plugin": "explicit -p pytest_cov"},
        "vite_config_loader": "runner", "application_services": "fresh owned loopback ports, explicit one worker, disposable policies/shared SQLite",
    },
    "advisory_check_date_warsaw": dependency["checked_at_warsaw"],
    "secrets_review": {"baseline_tracked_paths": 122, "reachable_commits": 44, "unique_history_blobs": 297, "candidate_context": "only synthetic fixtures; no values printed", "limitation": "heuristic patterns cannot prove absence of all arbitrary/encoded secrets", "evidence": ["reviewer-baseline.json", "reviewer-expanded-secrets.json"]},
    "cleanup": {"backend": live["all_owned_processes_stopped"], "normal": normal["cleanup"], "guarded": guarded["cleanup"], "frontend_preview_and_exact_disposable_files": frontend["cleanup"]},
    "findings": [
        {"id": "F1", "severity": "high", "status": "fixed and independently rechecked including full16k containers", "before": ["primary-encoding-before.log", "primary-large-before.log", "reviewer-large-encoded-before.json"], "after": ["primary-large-after.log", "reviewer-large-encoded-after.json"]},
        {"id": "F2", "severity": "medium", "status": "duplicate/nonfinite trusted corpus integrity fixed", "before": ["backend-corpus-reproduction.json", "backend-nonfinite-red.log"], "after": ["backend-owned-green.log", "reviewer-corpus-nonfinite-after.json", "reviewer-final-probes.json"]},
        {"id": "F3", "severity": "low", "status": "CSP font configuration fixed", "before": "frontend-before-observations.json (tool transcript summary; raw original log unavailable)", "after": "frontend-fixture-browser.log"},
        {"id": "F4", "classification": "required contract/defense-in-depth hardening; no displayed exploit reproduced", "status": "sensitive response extras visibly rejected", "before": "frontend-sensitive-fields-before.log", "after": ["frontend-unit-coverage.log", "reviewer-frontend-probes.json"]},
    ],
    "limitations_and_blockers": [
        "Human A/B sign-off remains pending; agents cannot supply it",
        "CP2/CP3 semantic requirements, allowed-model catalog and configurable semantic strictness remain unresolved; no model/semantic AI/real forwarding exists",
        "CP4 reporting/export/CSV UI absent on target; current PR3 features require security-preserving integration and re-verification; generic administrative JSON schemas remain bounded/untyped/not rendered",
        "CP5 release commit/integration and human CP6 startup/two-rehearsal not certified by this working-tree audit",
        "Guarded runtime simulates external network unavailability; no host disconnect, native/UDP/subprocess egress certification or offline installation",
        "No visual baseline/axe/screen-reader/CWV certification",
        "Unknown/recursive/alternative secret encodings remain outside bounded pattern masker",
        "Production identity/TLS/MFA/revocation/ACL/ingress, real sink authorization, immutable retention/backup/recovery remain gates; Python lock artifact hashes absent",
    ],
    "earlier_attempts": [
        "Existing pre-audit reports/test counts are historical and do not substitute for final427/100 working-tree checks",
        "Initial pytest temp-directory permissions and timestamp tzdata helper failures preceded application verification; unique owned temp paths and fixed Warsaw offset used",
        "backend-live-results.json records initial SQLite handle-cleanup harness failure; final owned run closes handles, stops services and removes state",
        "frontend-real-browser-harness-isolation-failed.log records telemetry sample exhaustion in reused test process; fresh independent browser demo fixes harness isolation",
        "frontend-real-browser-fixture-favicon-failed.log and denied-cancellation observer failure are retained test-harness failures, not product leak bypasses",
        "frontend-build-acceptance-command.json records actual Vite exit0; wrapper then hit Windows console UnicodeEncodeError. UTF8 output repaired; frontend-build-verified-command.json exits0 including wrapper",
        "CSP before failure recorded honestly as transcript summary, not a claimed retained raw log",
    ],
    "evidence_files_sha256": {name: sha(REPORT / name) for name in files},
}
(REPORT / "VERIFICATION.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
print(json.dumps({"final_source_unchanged": True, "diff_sha256": source["tracked_diff_sha256"], "backend_tests": 427, "frontend_tests": frontend["results"]["unitTests"], "live_cases": len(live["cases"]), "evidence_files": len(files)}, indent=2))
