// The checks the delivery gate runs (docs/0142, section 2). One list, one place: a check that is not here does not decide
// whether a commit is green. Each check names a program and arguments (never a shell string), a time limit, and the fixed
// sentence a failure record says it expected; a record never contains the check's own output.
//
//   tier  "fast"  runs before every push; "full" adds what is too slow or needs Docker, and runs before a merge to main
//   needs ["postgres"]  the gate starts one disposable Postgres for the run and gives it to these checks
//   serial  checks that share a key never run at the same time (cargo holds a lock on the build directory)
//   after [ids]  start only once these have passed; if one did not, this check is skipped (and a skip is not a pass)
//
// `gaps` are things that should be checks and are not yet. They are printed on every run and written into the baseline, so a
// missing check is visible and is never mistaken for a passing one.

const node = (...args) => ({ program: "node", args });
const cargo = (...args) => ({ program: "cargo", args });

export const checks = [
  { id: "deps", tier: "fast", title: "JavaScript dependencies the checks below need", command: node("scripts/gate/ensure-deps.mjs", "kernel/contracts/v1", "kernel/domains/connectors/github/tests/fixtures"), timeoutSeconds: 300, expect: "the dependencies pinned by each package-lock.json install" },
  { id: "documents", tier: "fast", title: "Versioned documents: type-check, export drift, tests", command: node("scripts/test-documents.mjs"), timeoutSeconds: 300, expect: "the versioned documents type-check, match their exported schemas and pass their tests" },
  { id: "gate-tests", tier: "fast", title: "The gate's own tests", command: node("--test", "scripts/gate/gate.test.mjs"), timeoutSeconds: 300, expect: "the gate's own tests pass" },
  { id: "absorb-tests", tier: "fast", title: "Absorb, alerts, hygiene and the poke: tests against real git repositories", command: node("--test", "scripts/gate/absorb-land.test.mjs", "scripts/gate/absorb-safety.test.mjs", "scripts/gate/absorb-alerts.test.mjs", "scripts/gate/absorb-hygiene-poke.test.mjs", "scripts/gate/absorb-resume.test.mjs"), timeoutSeconds: 300, expect: "landing a branch, finishing one that stopped, the alerts and the hook text behave as specified against real git repositories" },
  { id: "kernel-boundaries", tier: "fast", title: "Kernel layering rules", command: node("scripts/check-kernel-boundaries.mjs"), timeoutSeconds: 60, expect: "no kernel crate depends on one it must not" },
  { id: "kernel-boundaries-tests", tier: "fast", title: "Kernel layering rules: the rules' own tests", command: node("--test", "scripts/check-kernel-boundaries.test.mjs"), timeoutSeconds: 60, expect: "the layering rules catch each violation they are written to catch" },
  { id: "kernel-package-tests", tier: "fast", title: "Kernel build context isolation", command: node("--test", "scripts/kernel-package.test.mjs"), timeoutSeconds: 60, expect: "kernel packaging excludes inherited paths, private state, links and identical import blobs" },
  { id: "zod-ceiling", tier: "fast", title: "Zod ceiling", command: node("scripts/check-zod-ceiling.mjs"), timeoutSeconds: 60, expect: "no new code imports Zod and the inherited count has not risen" },
  { id: "zod-ceiling-tests", tier: "fast", title: "Zod tracked-source scan", command: node("--test", "scripts/zod-migration/candidates.test.mjs"), timeoutSeconds: 60, expect: "the Zod prefilter preserves tracked working-tree and binary source matches" },
  { id: "lineage-ceiling", tier: "fast", title: "Lineage ceiling", command: node("scripts/lineage-census.mjs", "--check"), timeoutSeconds: 120, expect: "the count of files identical to the upstream import has not risen" },
  { id: "lexicon", tier: "fast", title: "Lexicon", command: node("--test", "scripts/lexicon.test.mjs"), timeoutSeconds: 60, expect: "the lexicon is well formed and every term resolves" },
  { id: "migration-map", tier: "fast", title: "Migration map", command: node("scripts/map-migration.mjs", "--check"), timeoutSeconds: 120, expect: "the generated migration map matches the tree" },
  { id: "capability-map", tier: "fast", title: "Capability map", command: node("scripts/map-capabilities.mjs", "--check"), timeoutSeconds: 120, expect: "the generated capability map matches the tree" },
  { id: "capability-surface-ui", tier: "fast", title: "Capability surface: UI routes", command: node("scripts/check-capability-surface.mjs", "--check-ui"), timeoutSeconds: 120, expect: "no UI route has been lost from the recorded surface" },
  { id: "kernel-clippy", tier: "fast", title: "Kernel: clippy with warnings as errors", command: cargo("clippy", "--workspace", "--all-targets", "--", "-D", "warnings"), cwd: "kernel", timeoutSeconds: 900, serial: "cargo", expect: "the kernel builds with no clippy warning" },
  { id: "kernel-tests", tier: "fast", title: "Kernel: every crate's tests except the server's", command: cargo("test", "--workspace", "--exclude", "vaultixd"), cwd: "kernel", timeoutSeconds: 1200, serial: "cargo", after: ["deps"], needs: ["postgres"], expect: "every kernel crate's tests pass against a real database" },
  // The auth journeys run the real `vx` client, and `cargo test -p vaultixd` does not build another package's binary, so it is built first.
  { id: "kernel-client-build", tier: "fast", title: "Kernel: the vx client builds (the auth journeys run the real one)", command: cargo("build", "-p", "vx-client", "--bin", "vx"), cwd: "kernel", timeoutSeconds: 900, serial: "cargo", expect: "the vx client builds" },
  // Every integration test file of the server is named here: cargo runs only the ones named, and a test that no check runs proves nothing
  // (the gate's own tests fail when a file under kernel/server/tests is missing from this list or from the full tier's drills).
  { id: "kernel-server-tests", tier: "fast", title: "Kernel: the server's unit, API and auth tests", command: cargo("test", "-p", "vaultixd", "--bins", "--test", "api", "--test", "auth"), cwd: "kernel", timeoutSeconds: 900, serial: "cargo", after: ["kernel-client-build"], needs: ["postgres"], expect: "the server's unit, API and auth tests pass against a real database" },
  { id: "contract-v1", tier: "fast", title: "The v1 contract: OpenAPI from Rust and the generated types", command: node("scripts/test-contract-v1.mjs"), timeoutSeconds: 900, serial: "cargo", after: ["deps"], expect: "the committed OpenAPI and generated types match the Rust contract" },

  { id: "kernel-drills", tier: "full", title: "Kernel: failure drills against the real server process", command: cargo("test", "-p", "vaultixd", "--test", "drills", "--", "--test-threads=1"), cwd: "kernel", timeoutSeconds: 1200, serial: "cargo", needs: ["postgres"], expect: "every failure drill passes against the real vaultixd process" },
  { id: "documents-mutation", tier: "full", title: "Delivery-gate documents: planted bugs are caught", command: node("scripts/mutation-gate-documents.mjs"), timeoutSeconds: 600, expect: "every planted bug in the delivery-gate documents makes a test fail" },
  { id: "gate-mutation", tier: "full", title: "The gate itself: planted bugs are caught", command: node("scripts/mutation-gate.mjs"), timeoutSeconds: 900, expect: "every planted bug in the gate makes one of its tests fail" },
  { id: "absorb-mutation", tier: "full", title: "Absorb, alerts, hygiene and the poke: planted bugs are caught", command: node("scripts/mutation-absorb.mjs"), timeoutSeconds: 1200, expect: "every planted bug in absorb, alerts, hygiene and the poke makes one of their tests fail" },
  { id: "table-namespaces", tier: "full", title: "Table namespaces", command: node("scripts/check-table-namespaces.mjs"), timeoutSeconds: 600, expect: "every table name and route follows the namespace rules" },
  { id: "kernel-image", tier: "full", title: "Independent kernel image and auth/secrets/recovery journey", command: node("scripts/build-kernel.mjs"), timeoutSeconds: 1800, expect: "the isolated kernel image builds and passes setup, secret redemption, revocation and encrypted recovery" }
];

export const gaps = [
  { id: "rustfmt", why: "46 kernel files differ from default rustfmt; a width has to be chosen (rustfmt.toml) before it can gate" },
  { id: "authorship-audit", why: "scripts/audit-codebase.mjs fails: reviewed files (15 on 2026-11-17, most from ordinary edits) changed since their review; a reviewer has to re-read them" },
  { id: "owned-tree", why: "scripts/check-owned.sh is a shell script and a flow or check may not be one; it needs a Node port" },
  { id: "standalone-image", why: "Dockerfile.standalone-vaultix has to build as part of the full tier; its time is not measured yet" },
  { id: "frontend", why: "the frontend build, Storybook and accessibility tests are not in the gate; the frontend is being rebuilt in Svelte" },
  { id: "feature-flows", why: "no feature manifest exists yet, so no flow proof runs; the secrets feature is the first to be authored whole" },
  { id: "inherited-script-tests", why: "most scripts/*.test.mjs files (ai-journal, pr-verification, release-*, ui-*, warp-points, prepare-local-integration) are run by no check; whether they pass is not known, so each has to be run and then gated or retired" }
];
