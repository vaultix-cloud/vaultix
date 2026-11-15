# 0136: Kernel, platform, control, and the schema layer

**Status:** decided by the owner 2026-11-15; execution started. **Supersedes:** the folder tree in 0134
section 4, the `platform/engine/vx` location, the v0.24.0 tag choice (the product is **0.5.0-alpha**), and the
Zod parts of 0129. **Builds on:** 0127 (one API), 0133 and 0134 (foundation), 0135 (process review).

Vaultix is treated as a new product, not a continuation of the inherited engine. There is no v1, v2 or v3
compatibility anywhere. The one API is `/api/vx/v1`, and the product release is **0.5.0-alpha** (tag
`v0.5.0-alpha.N`; versions still come from git tags).

## 1. Three parts and a separate assistant

| Part | What it is | Depends on | Folder |
| --- | --- | --- | --- |
| **kernel** | The engine. Every feature included, no tiers, self-hostable. It is the old core plus the free half of the old `ee` folder. Rust. | nothing outside itself | `kernel/` (new) |
| **platform** | The hosted offering: tenants, billing, provisioning of customer instances. | the kernel's contract | `platform/shippin/` (exists) |
| **control** | The cloud panel management: the factory that deploys and operates managed and hosted instances. Private, separately deployed. | the kernel's contract; never holds a value | `control/` (created when its first code lands; today the private `vaultix-control` console, docs 0125) |
| **assistant** | The chat, per space, with its own LLM configuration. A separate service. | the kernel's authorized tools only | `kernel/services/assistant/` (next) |

Rules, enforced by a script (`scripts/check-kernel-boundaries.mjs`): the kernel depends on neither platform
nor control; foundation crates depend only on foundation; a domain depends on foundation and itself; only
`server` and `clients` assemble domains. `platform/engine/` (the inherited Node and Go engine) is legacy: it
shrinks as each domain moves into `kernel/`, and nothing new is added to it. There is no `core` folder.

## 2. The kernel's layout

```text
kernel/
  Cargo.toml  clippy.toml  README.md
  foundation/        shared by every domain; never depends on a domain
    secret/  store/  keys/  gate/  audit/  jobs/
  domains/           one folder per canonical domain (docs/0120); each the same shape
    secrets/
      core/          the Rust crate: rules, store access, tests against a real Postgres
                     (next, as the domain grows: http/ mcp/ web/ contract/ tests/)
  server/            vaultixd: assembles the domains behind /api/vx/v1
  clients/
    cli/             vx (a person) and vx-mcp (an AI client's tool server)
  services/          separately deployed processes: assistant/ (next)
  contracts/         v1 OpenAPI and the generated TypeScript (next)
```

Why this shape. The usual Rust guidance for a workspace of this size is a flat `crates/` directory with
folders named after their crates, and it warns that hierarchies decay (empty folders, a `utils` that
collects everything). That guidance is right about the failure mode, so the nesting here is limited to two
levels and every level has a rule: **foundation** (shared, no domain knowledge) and **domains/<domain>/<role>**
(everything about one context together). Package names stay flat (`vx-secrets`, `vx-keys`) so Cargo and
tooling are unaffected; the workspace finds members by glob (`foundation/*`, `domains/*/core`). A new crate
must belong to foundation or to a domain; a folder named `utils`, `common` or `shared` is refused.

## 3. The schema layer: ArkType, Standard Schema, and Zod's retirement

### What the research found (checked 2026-11-15)

| Fact | Source |
| --- | --- |
| ArkType is at **2.2.9** (published 2026-10-20). 2.2.0 (2026-02-10) added `type.fn` (validated functions), typed regex, configurable `toJsonSchema`, `@ark/json-schema`, and Standard JSON Schema. No 2.3 or 3.0 is announced. | [ArkType 2.2](https://arktype.io/docs/blog/2.2), npm registry |
| **Standard Schema** is `@standard-schema/spec` 1.1.0. **Standard JSON Schema** is the companion interface (`~standard.jsonSchema.input/output({ target })`); ArkType implements it (2.1.28 and later). | [standardschema.dev](https://standardschema.dev/json-schema) |
| TanStack Router takes an ArkType type directly in `validateSearch`; no adapter. | [TanStack docs](https://tanstack.com/router/latest/docs/framework/react/how-to/validate-search-params) |
| `@ark/json-schema` is **0.0.13**, pre-1.0. | npm registry |
| `@hookform/resolvers` is at 7.0.6; the frontend is on ^3.9.1. | npm registry |
| Our Zod use: **2,065 tracked files** import Zod or an adapter; backend about 21,700 `z.` uses in 1,109 files, frontend about 5,600 in 671. Zod is 3.22 and 3.24 here; 4.6.7 is current. | `scripts/check-zod-ceiling.mjs` |

### What the spike found (run 2026-11-15)

`@ark/json-schema` 0.0.13 was fed the shapes a Rust contract emits. It validated objects (required,
bounds, `additionalProperties: false`), enums, arrays, both nullable forms, `pattern` and `oneOf`
correctly. Two results rule it out as the runtime path:

- **It silently ignores `format`.** A `date-time` or `uuid` field accepted "yesterday" and "nope". A
  validator that quietly gets weaker is worse than none.
- **It throws on a schema whose top level is a `$ref`/`$defs` document,** which is how OpenAPI components
  arrive.

ArkType's own keywords are strict where it was lax: `string.uuid`, `string.date.iso`, `string.email`,
`string.url`, `number.integer`, `string.hex` and `string.base64` all accepted a good value and rejected a bad
one; `type.fn` rejected bad arguments; every type exposes the Standard Schema surface and
`toJsonSchema()`.

### Decisions

1. **ArkType 2.2.x is the schema library, through Standard Schema.** Anything that consumes a schema
   (router, forms, AI tool definitions) takes the Standard Schema interface, so no consumer is tied to
   ArkType. New code never imports Zod.
2. **The contract is Rust-first.** The kernel's request and response types generate an OpenAPI 3.1
   document (`kernel/contracts/v1/openapi.json`, checked in, with a drift test). That document is the one
   source for the TypeScript side.
3. **We generate ArkType source, not validators at runtime.** A strict generator turns each OpenAPI schema
   into committed ArkType definitions, mapping `format` to ArkType keywords and **failing loudly on any
   construct it cannot map**. Generated source gives static types (by inference) and strict runtime
   validation together. `@ark/json-schema` stays a watched dependency, not a runtime one, until it handles
   `format` and `$ref`.
4. **Zod retires by deletion, then by ratchet.** Converting 2,065 files that are about to be deleted is waste.
   Instead: every domain that moves into the kernel deletes its Zod with it; every screen rewritten on the
   design system uses ArkType; and `scripts/check-zod-ceiling.mjs` holds new code (kernel, control,
   `platform/shippin`) at zero Zod and the inherited count at a ceiling that may only fall (2,065 today).
   What survives untouched at the end gets a mechanical conversion, then the dependency is removed.
5. **Forms and routes.** Forms move to `@hookform/resolvers` 7's Standard Schema resolver once confirmed on
   the first rewritten form (not yet verified); routes use ArkType directly in `validateSearch`.

## 4. What "v1 established" means in an alpha

During 0.5 alpha the v1 contract may still change, but only in one way: a change to the OpenAPI document,
the generated ArkType source, the server and the contract tests lands in the same commit, with no shim and
no old route. The drift test fails the build otherwise. At beta the contract freezes and the
`Vaultix-Version` date header (0127) governs change. There is no `/api/v1` to `/api/v4` inherited surface in
the kernel.

## 5. The assistant: a separate chat that cannot leak

One service per deployment, with a configuration per **space** (a tenant's workspace): which model it uses
(the customer's own API key, a Hugging Face endpoint, a custom endpoint, or the Vaultix-owned model, per
docs/0126), kept encrypted by the kernel.

What makes it unable to leak, as controls that can be tested, not as a promise:

- **No value access, by construction.** The assistant has no database access and no keys. It speaks to the
  kernel only through the same authorized tool surface as any AI client (metadata, requests for a person to
  supply a value, approved profiles), under its own identity limited to the space.
- **A gate on every model request.** Each request to the model passes the output gate with the space's
  planted canaries and learned values before it leaves, and is recorded as hashes and counts, never content.
- **Egress to one place.** The service may open a connection to its space's configured model endpoint and the
  kernel, nothing else; enforced by network policy in the deployment and checked at start-up by trying a
  forbidden destination. For the Vaultix-owned model: no storage of prompts, no training, no per-person
  analytics (0133 section 4).
- **Proof, not trust.** The capability proof (`scripts/prove-vx-capability.mjs`) grows an assistant run: a
  canary secret, an adversarial conversation, and a scan of every outbound model request for any form of it.

Honest limits: a customer who points the assistant at a third-party model sends that model the conversation
and metadata, and Vaultix cannot control what that provider keeps; transformation attacks on opted-in output
remain (kernel README). "Cannot leak" means no value can reach it through Vaultix's paths and every path is
tested, which is what we can prove.

## 6. The control plane

A third part, not a folder of the engine: it provisions an instance per hosted customer, handles billing,
upgrades and support access, and never holds a customer's secret values or root key. It talks to an instance
through a narrow, authenticated instance-agent API defined in the kernel contract. `platform/` and `control/`
may depend on the kernel; the kernel never depends on either.

## 7. Order of work

1. **Contract slice. Done 2026-11-15** for status, secrets and operate (11 operations, 28 schemas):
   typed request and response structs in `kernel/foundation/contract`, the OpenAPI 3.1 document generated from
   them (`kernel/contracts/v1/openapi.json`), the strict generator, committed ArkType source, a static-type
   check, and contract tests that call the real server and validate every answer. `node scripts/test-contract-v1.mjs`
   fails on drift between the Rust types, the document and the generated TypeScript. The tests were themselves
   mutation-tested (a field the contract does not declare, a generator that weakens `date-time`). Requests reject
   unknown fields, so a misspelled field is an error, not silence; every error is `{ code, error }`.
2. **Identity domain,** so the bootstrap token stops being a full-power credential.
3. **Assistant service skeleton** with the egress test and the model-request gate.
4. **First rewritten screen** on the design system with ArkType, to prove forms and routes; lower the Zod
   ceiling as screens and domains move.
5. **Linux container and the same-harness idle comparison** (0132a section 4).
6. Retire `platform/engine` domain by domain, per 0135.

## 8. Open for the owner

| Decision | Needed before |
| --- | --- |
| Where `control/` lives: in this repository, or the private `vaultix-control` repository | Control's first code |
| PKI and PAM scope for 0.5 (0135 section 9), SRP accounts, Redis dropped | Domain moves for those areas |
| Which Nomen and Wardenclyffe, and the licence review | Any identity federation work |
