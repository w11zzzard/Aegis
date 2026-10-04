# ECC CP1 security audit archive

This preserves the sanitized evidence from the completed local audit before the
user's subsequent request to commit/publish it. Statements that no commit/push
occurred describe that earlier audit phase, not the later publication step.

The tested baseline is e52eb5059bba618db768c17353256d9eb516938c plus the reviewed
working-tree changes. The archived manifests keep their original timestamps,
paths and source hashes. They are historical evidence, not a newly merged release
or production certificate. Application and regression sources are unchanged by
this publication; only this archive and the checkpoint document are added.

Start with [HARDENING_SUMMARY.md](HARDENING_SUMMARY.md),
[FINDINGS.md](FINDINGS.md), [SECURITY_COVERAGE.md](SECURITY_COVERAGE.md) and
[VERIFICATION.json](VERIFICATION.json). Absolute Windows paths record the audit
environment. Caches, installed dependencies, temporary databases and test state
are excluded. Credentials/payloads in tests and evidence are synthetic.

Human sign-off, semantic requirement resolution, reporting/export integration and
release/production certification remain separate checkpoints.
