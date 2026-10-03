# Independent frontend cleanup review — 4 October 2026

The independent reviewer found no demonstrated unresolved issue in the final `frontend/src/api.ts` cleanup. Review used the ECC `security-review` and `e2e-testing` skills and read the implementation, adapters, stream tests and actual HTTP fixture. No production code or dependencies changed during this review.

The status failure path never reads or renders the upstream error body. Its `finally` aborts the transport before initiating cancellation. Cancellation rejection is observed and synchronous cancellation exceptions are contained; cancellation promises are never awaited. The ten-second body-read race removes its abort listener when either branch settles. The successful-body path counts actual bytes rather than trusting Content-Length and rejects invalid UTF-8 and JSON. Adapter validation follows complete EOF, so a schema failure has no unread stream to cancel.

Two additional independent regressions cover gaps in the existing acceptance tests:

- A native stream emits a partial chunk, then fails its next read with synthetic private transport detail. The client returns the sanitized interruption error, aborts the transport, removes every installed abort listener, releases the native reader lock and clears its timer. Rejected cleanup produces no Vitest unhandled error.
- The native reader's `cancel()` method throws synchronously while a real read remains pending at the deadline. The client still settles with the sanitized timeout error, releases the native reader lock and clears its timer. The pending read's release rejection is handled. The synthetic stream is canceled during test teardown after restoring the native method.

These checks are retained in `frontend/src/api-streams-independent.test.ts`. The final focused run passes 34/34 across that file, `api-streams.test.ts` and `api.test.ts`. See [frontend-independent-streams.log](frontend-independent-streams.log). TypeScript validation exits 0; its [log](frontend-independent-typecheck.log) is empty because the compiler emits no output on success.

The actual loopback HTTP fixture independently passes all six finite, oversized, endless, stalled, false-small and false-large 503 cases. Each server records its socket closing, `signal.aborted=true`, and an incomplete body; the largest recorded transfer is 65,536 bytes. Cases finish within 40 ms in this run, below the fixture's one-second acceptance threshold and 1.5-second watchdog. See [frontend-independent-http.log](frontend-independent-http.log). The false-small framing case can disconnect because of HTTP protocol handling; the explicit application abort assertion independently verifies cleanup. The fixture uses Node fetch, while separate project browser evidence covers Chrome application journeys.

Exact final commands, executed in `frontend/` with the installed bundled runtime:

```powershell
& 'C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'node_modules\vitest\vitest.mjs' run src/api-streams-independent.test.ts src/api-streams.test.ts src/api.test.ts --reporter=verbose --configLoader=runner 2>&1 | Tee-Object -FilePath '..\docs\security-review\2026-10-04\frontend-independent-streams.log'; exit $LASTEXITCODE
& 'C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'node_modules\vitest\vitest.mjs' run --config vitest.streams.config.ts --reporter=verbose --configLoader=runner 2>&1 | Tee-Object -FilePath '..\docs\security-review\2026-10-04\frontend-independent-http.log'; exit $LASTEXITCODE
& 'C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'node_modules\typescript\bin\tsc' --noEmit 2>&1 | Tee-Object -FilePath '..\docs\security-review\2026-10-04\frontend-independent-typecheck.log'; exit $LASTEXITCODE
```

All three commands exit 0. An initial typecheck identified implicit callback parameter types in the new review test; those were repaired before the recorded final rerun. This was a test-only authoring correction, not an application defect. The full active frontend suite now contains two additional tests and requires the coordinated final full-suite run to report the final aggregate. No deployed ingress, TLS or other browser engine coverage is claimed by this review.
