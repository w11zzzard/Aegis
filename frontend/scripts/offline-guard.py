"""Owned verification wrapper: deny external networking before importing AEGIS."""

import socket
import sys

LOOPBACK = {"127.0.0.1", "::1", "localhost"}


def guard(event, args):
    if event == "socket.connect":
        address = args[1]
        host = address[0] if isinstance(address, tuple) and address else None
    elif event in {"socket.getaddrinfo", "socket.gethostbyname", "socket.gethostbyaddr"}:
        host = args[0]
    else:
        return
    if isinstance(host, bytes):
        host = host.decode("ascii", errors="strict")
    if host not in LOOPBACK:
        raise PermissionError("Synthetic verification guard: external network unavailable")


sys.addaudithook(guard)
blocked = 0
for probe in (
    lambda: socket.getaddrinfo("aegis-owned-negative.invalid", 443),
    lambda: socket.socket().connect(("192.0.2.1", 443)),
):
    try:
        probe()
    except PermissionError:
        blocked += 1
assert blocked == 2, "Both external DNS and socket probes must be denied before OS networking"
print("AEGIS_OFFLINE_GUARD_SELF_PROBE_PASS: DNS and connect blocked", file=sys.stderr, flush=True)

import uvicorn  # noqa: E402 - the guard must precede application imports

uvicorn.run("backend.main:app", host="127.0.0.1", port=int(sys.argv[1]), workers=1, access_log=False)
