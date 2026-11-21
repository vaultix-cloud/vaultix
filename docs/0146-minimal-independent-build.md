# 0146: Minimum independent build, before the rest of the rewrite

Owner request, 2026-11-20: prioritize the bare essentials needed to stop shipping
the inherited application. Full parity remains a product obligation; it must not
be confused with the ability to build a separate, explicitly scoped candidate.
The question of which workflows the owner needs in that first candidate remains
unanswered. No current workflow was removed by this change.

## Why the existing work did not produce independence

At `3f46e888`, `node scripts/lineage-census.mjs` reports 9,386 byte-identical
imported files and 1,763 modified inherited files out of 12,679 tracked files.
The image in `platform/engine/Dockerfile.standalone-vaultix` still builds the
inherited frontend, Node backend and Go sidecars. The new kernel was developed
beside that delivery path. Removing license enforcement and changing names did
not change those build inputs.

## Concrete change

`node scripts/build-kernel.mjs [--prepare-only]` creates a new directory under
`.cache/`, copies an explicit set of kernel build sources, and records every
input's SHA-256. It refuses symlinks/junctions and bytes matching a blob from the
local import commit. It never contacts that upstream. The Docker build receives
only the prepared directory, per Docker's [build-context boundary](https://docs.docker.com/build/concepts/context/).

The standalone recipe builds only `vaultixd` and the `vx-client` binaries. Cargo
workspace sources are present for lockfile resolution; that is not a claim that
all domains are implemented or enabled. The image includes downloaded dependency
notice files. The byte comparison detects exact copies only: it does not detect
modified derivatives or establish licensing clearance. Existing third-party
notices and historical source remain in place.

## Evidence and remaining work

- The 58-file exported context builds all three native Windows binaries with
  `cargo build --locked --offline -p vaultixd -p vx-client --bins`. This used only
  the exported sources and the local Cargo registry cache.
- The packaging tests reject inherited paths, traversal, private state, identical
  imported blobs and a directory junction. They are registered in the fast gate.
- The first container attempt failed because `docker` was outside PATH. The
  existing Docker engine was then located and accessed with the required host
  permission. The Linux image built, generated its OpenAPI and passed 10 checks
  across real setup/login, write/list/redeem, wrong-session and replay denial,
  audit verification, logout, encrypted backup/restore and log non-disclosure.
  The tests use disposable databases and a loopback-published Docker network.
  They do not prove runtime egress isolation, full parity or migration from the
  inherited store. `kernel-image` runs this proof in the full gate.

Run `node scripts/build-kernel.mjs` with Docker on PATH to repeat that image
build and journey. The result records the immutable image ID and named checks.

Before an everyday cutover, finish the human session's write path (currently it
supports `list` and `logout`; the separate `set` command needs a supplied session
credential), session handling for MCP, and the required interface/workflows.
Before moving an existing instance, implement and rehearse the inherited-store
import preserving accounts, keys and secrets. Only then switch the delivery
entry point and remove the superseded runtime from that artifact. Broader
federation, connectors, PKI/PAM and UI parity are separate remaining work, not
silently counted as complete by this minimal package.
