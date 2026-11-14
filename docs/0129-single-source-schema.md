# 0129 — One API schema that every consumer is generated from or checked against

**Status:** research 2026-11-14, by AI, for owner review; not a decision.
**Relates to:** [0128](0128-api-lessons-learned.md) (what the API should say),
[0127](0127-one-api-infisical-as-a-source.md) (decision 2 asked for this),
[0126](0126-ai-configuration-schema.md) (the AI schema pattern), [0119](0119-schema-and-api-namespaces.md)
(`/api/vx/v1/<domain>`), [0027](0027-native-stack-and-ai-migration.md) (Go, Rust, React).

Every outside claim links to the page I read. A list of what I could not confirm is at the end.

## The problem

The API is described in at least six places, each kept by hand:

- The TypeScript backend builds OpenAPI from Zod through an in-house copy of
  fastify-type-provider-zod (`backend/src/server/plugins/fastify-zod.ts`), and AGENTS.md forbids
  Zod in new product TypeScript.
- The Go backend hand-writes OpenAPI 3.0 `openapi.yml` per handler (`platform/projects`,
  `secretmanager/secret`, both still the inherited `/api/v4` shapes) plus `shared/types.yaml`, and
  generates from them with DoorDash's oapi-codegen fork (v3.75.5 in `go.mod`).
- The AI domain has two hand-written JSON Schema 2020-12 files whose rules Go repeats by hand in
  `assistant/spec/spec.go`, held together by shared fixtures (Go tests plus
  `scripts/test-ai-contracts.mjs`).
- The frontend uses Zod in about 626 files and hand-written types. The Go CLI (`internal/api`)
  hand-writes its structs.
- MCP tool `inputSchema` objects are literals in `catalog.ts` and `reference-input.ts`.
- `contracts/*.json` and the capability-surface baseline sit alongside.

They already disagree. The Go `Error` type requires `reqId` and `statusCode`, while 0127 decided
on `requestId`. Moving about 1,570 inherited operations into redesigned domains (0127) would
repeat this drift for every domain unless there is one source.

## Options compared

| | Hand-written OpenAPI 3.1 | TypeSpec → OpenAPI 3.1 + JSON Schema | Protobuf + buf + Connect | Smithy | JSON Schema 2020-12 files, referenced by OpenAPI 3.1 |
| --- | --- | --- | --- | --- | --- |
| Maturity | Standard | 1.0 GA May 2025; versioning library still preview | Mature | Mature inside AWS | Standard |
| Go server and client | oapi-codegen, ogen | Same, from the emitted OpenAPI | connect-go | Go server "work-in-progress" | oapi-codegen, plus a real 2020-12 validator |
| TS types and validation without Zod | openapi-typescript, Ajv standalone | Same | protobuf-es (not researched) | Smithy TS (not assessed) | Same as OpenAPI, and the schema files feed Ajv directly |
| MCP input schemas | Extracted from the operations | Extracted | Must be derived | Must be derived | Used as they are |
| Rust | typify; progenitor needs 3.0.x | Same | prost/tonic (not researched) | smithy-rs (not assessed) | typify |
| Breaking-change CI | oasdiff | oasdiff on the output | buf breaking | Not researched | oasdiff |
| One maintainer's cost | Verbose YAML, no new tools | A new language and compiler in front of the same tools | REST design fights RPC paths | Not viable in Go | As OpenAPI, plus a bundle step |

**Hand-written OpenAPI 3.1.** OpenAPI 3.1 "is now a JSON Schema dialect", and `nullable` was
replaced by type arrays ([OpenAPI 3.1 migration](https://www.openapis.org/blog/2021/02/16/migrating-from-openapi-3-0-to-3-1-0)).
That is what lets one schema serve every consumer. MCP's 2025-11-25 spec makes 2020-12 the
default dialect for `inputSchema` and `outputSchema`
([MCP tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)). Ajv supports
2020-12 ([Ajv drafts](https://ajv.js.org/json-schema.html)). On the Go side,
santhosh-tekuri/jsonschema supports 2020-12 and passes the JSON-Schema-Test-Suite apart from its
optional tests ([repo](https://github.com/santhosh-tekuri/jsonschema)).

For Go code generation, upstream oapi-codegen's FAQ says initial 3.1 support has landed
([oapi-codegen](https://github.com/oapi-codegen/oapi-codegen)). The DoorDash fork already in use
claims 3.0 and 3.1 support and generates `Validate()` methods with go-playground/validator, but
its published compatibility results cover 3.0 specs only
([oapi-codegen-dd](https://github.com/doordash-oss/oapi-codegen-dd)). ogen generates a static
server, client and validation, but its README does not say whether it supports 3.1
([ogen](https://github.com/ogen-go/ogen)).

For TypeScript, openapi-typescript makes types from 3.0 and 3.1 with no runtime
([openapi-ts](https://openapi-ts.dev/introduction)), and openapi-fetch is a 6 kB client checked at
compile time only ([openapi-fetch](https://openapi-ts.dev/openapi-fetch/)). Ajv standalone compiles
validators at build time, which avoids the `Function` constructor and shrinks the bundle
([Ajv standalone](https://ajv.js.org/standalone.html)). react-hook-form has an Ajv resolver
([resolvers](https://github.com/react-hook-form/resolvers)).

For Rust, progenitor reads OpenAPI 3.0.x only ([progenitor](https://github.com/oxidecomputer/progenitor)).
typify turns JSON Schema into Rust types but does not enforce numeric bounds, and models `anyOf`
loosely ([typify](https://github.com/oxidecomputer/typify)).

For breaking changes, oasdiff (Apache-2.0) has a `breaking` command, covers 3.1 and 3.2, and runs
in CI ([oasdiff](https://github.com/oasdiff/oasdiff)). Optic was archived on 2026-01-12
([optic](https://github.com/opticdev/optic)).

**TypeSpec.** At 1.0 GA the compiler, the HTTP and OpenAPI libraries, and the OpenAPI 3 and JSON
Schema emitters are stable. The client and server generators, and the versioning, rest and events
libraries, are still preview ([GA post](https://typespec.io/blog/typespec-1-0-GA-release/)). The
OpenAPI emitter can write 3.0.0, 3.1.0 or 3.2.0, defaulting to 3.0.0
([emitter](https://typespec.io/docs/emitters/openapi3/reference/emitter/)). Versioning uses a
`@versioned` enum with `@added`, `@renamedFrom` and `@madeOptional`
([guide](https://typespec.io/docs/libraries/versioning/guide/)), and Azure's guide says "the
emitter will produce outputs for all versions"
([Azure](https://azure.github.io/typespec-azure/docs/howtos/versioning/06-evolving-apis/)).

It is concise and has templates for repeated shapes. But it is one more language whose output is
the same OpenAPI that oapi-codegen and openapi-typescript read, so every problem is debugged two
layers deep. Its versioning, the main reason to want it here, is still preview.

**Protobuf with buf and Connect.** This has the best breaking-change tool: `buf breaking`, against a
git ref, with a `WIRE_JSON` category ([buf](https://buf.build/docs/breaking/)). But Connect paths
are `/package.Service/Method`, mostly POST, and "paths identify RPC procedures" rather than
resources ([Connect](https://connectrpc.com/docs/protocol/)). ProtoJSON omits default-valued
fields, writes int64 as strings, and "is not designed to be able to represent arbitrary JSON
schemas" ([ProtoJSON](https://protobuf.dev/programming-guides/json/)). 0128's design is REST: paths
by domain, ETag and If-Match, Idempotency-Key, lengths and patterns. Protobuf would need a gateway
and a separate rules layer, and MCP would still need derived JSON Schema. It is the wrong fit.

**Smithy.** Smithy is protocol-agnostic and converts to OpenAPI ([Smithy](https://smithy.io/2.0/index.html)).
But smithy-go's server generator is "work-in-progress, undocumented", it "does not currently
implement server-side protocol support", and non-AWS clients are "in an early stage"
([smithy-go](https://github.com/aws/smithy-go)). That rules it out for a Go server.

**JSON Schema files referenced by OpenAPI.** This uses the same tools as hand-written OpenAPI, but
each model is its own 2020-12 file with an `$id`. The OpenAPI document holds only paths,
parameters and responses, and refers to the model files. It generalises what the AI domain already
does. Code generators want one file, and Zalando's guidelines also ask for "a single
self-contained YAML file" ([Zalando rule 101](https://opensource.zalando.com/restful-api-guidelines/)),
so a bundle step produces it.

## What keeps consumers from drifting

- **Generated types turn drift into compile errors.** One developer's report on oapi-codegen plus
  generated Dart clients puts it as "With codegen, drift becomes a compile error". The same report
  says the pain points were error responses missing from generated clients, and patch scripts
  between tools ([dev.to, 2026](https://dev.to/tkode_dev/i-let-my-openapi-spec-do-the-work-one-contract-for-go-flutter-and-the-llm-c20)).
  It is one anecdote, not a survey.
- **Types do not carry rules.** The weak point in 0126 is that Go repeats the schema's rules by hand.
  The fix is to run the same schema through a real 2020-12 validator on both sides (Ajv in the
  browser, santhosh-tekuri in Go). Then only the rules a schema cannot express are written by hand,
  and fixtures pin those.
- **Check responses as well as requests.** The existing oapi-codegen config already enables response
  validation. Schemathesis can generate property-based tests from OpenAPI 3.1
  ([Schemathesis](https://schemathesis.readthedocs.io/en/stable/)), but it is a Python toolchain.
  It is an option for later, not a first step.
- **Schema first.** The schema change is written and reviewed before the handler, as in Zalando's
  "API first" rule 100 (same page).

## Dated versions in a schema-first workflow

Stripe keeps each breaking change in a "version change module", lists modules per date in one
`VERSIONS` table, builds every response in the newest shape, and "walks back through time" to the
caller's version. It generates its changelog from the modules ([Stripe](https://stripe.com/blog/api-versioning)).
TypeSpec records the same history as decorators. OpenAPI Overlays (v1.2.0) apply ordered JSONPath
`update` and `remove` actions to a document ([Overlay](https://spec.openapis.org/overlay/latest.html)).
That is good for docs variants, but too weak to describe what a version means.

**Recommended for Vaultix.** The schema at HEAD is always the newest version.

- `versions.yaml` is Stripe's table as data: each date, with change entries (id, summary,
  affected operations and schemas).
- At each public release the bundled document is frozen under `released/<date>/`. That frozen copy
  is the spec of that version, with nothing to regenerate.
- The server has one Go transform per change entry, and a check makes sure entries and transforms
  match one to one.
- `oasdiff breaking` between the last frozen copy and HEAD must come back empty, unless a new
  dated entry names those changes.

Before the first public release none of this runs: the registry is empty and routes are deleted
outright (AGENTS.md, 2026-11-11). Each customer runs their own instance, so the instance release
is already the pin (0128).

## Recommendation

**One source: JSON Schema 2020-12 model files plus one hand-written OpenAPI 3.1 document of
paths, in `platform/engine/api/`.** It goes under `platform/engine` because the engine image and
its Go tests see only that tree (0126). Go `embed` cannot reach outside a module
([embed](https://pkg.go.dev/embed)), so generated copies are written into the packages that embed
them.

```
platform/engine/api/
  openapi.yaml                  info, security, shared parameters and responses
  paths/<domain>.yaml           one per canonical domain (0119)
  schemas/common/*.schema.json  the shared definitions below
  schemas/<domain>/*.schema.json
  fixtures/<domain>/*.json      valid and invalid documents, as in 0126
  versions.yaml                 empty until the first public release
  released/<date>/openapi.json  frozen at each public release
  dist/openapi.json             bundled; generated and committed
```

A few `x-vaultix-*` extensions carry what OpenAPI lacks:

- `x-vaultix-mcp` gives the tool name and its read-only and destructive hints.
- `x-vaultix-values: true` marks the only operations that return secret values (redeem). The MCP
  generator refuses to expose these, which enforces AGENTS.md's rule that no value reaches an AI.
- `x-vaultix-audit` gives the audit action.

**Generated (committed, regenerated by one command):**

| Consumer | From | Tool |
| --- | --- | --- |
| Go types, chi adapters, service interfaces, one package per domain | `dist/openapi.json` | oapi-codegen-dd (already in `go.mod`) |
| Go request validation | embedded schema files | santhosh-tekuri/jsonschema, the single authority for structural rules |
| Go CLI client (`internal/api`) | `dist/openapi.json` | oapi-codegen client |
| UI types | `dist/openapi.json` | openapi-typescript |
| UI form and request validators | schema files | Ajv standalone, plus a small react-hook-form resolver that maps `instancePath` to fields |
| MCP tool list (`inputSchema`, `outputSchema`, annotations) | operations with `x-vaultix-mcp` | small in-repo script, replacing the literals in `catalog.ts` |
| A vx route still in TypeScript (such as provider import) | schema files | the same Ajv standalone validators; no new Zod |
| API docs, served at `/api/vx/v1/openapi.json` | `dist/openapi.json` | any 3.1 renderer (choice open) |
| Rust types, later | schema files | typify; a hand-written client until progenitor reads 3.1 |

**Stays hand-written:** handlers and services; rules a schema cannot state (permission before
existence, credential-shaped text, cross-resource checks); version transforms; UI components and
query hooks; CLI command design; persona content.

**Checks.** These run as canonical build stages in `scripts/build-self-hosted.mjs`, because GitHub
workflows are manual-only ([0048](0048-self-hosted-builds.md)).

1. `node scripts/api.mjs check`:
   - every schema compiles in Ajv 2020 strict mode;
   - the bundle is reproducible;
   - a convention lint passes: camelCase, no `_id`, every list takes `pageSize` and `pageToken`
     and returns the list envelope, every error response refers to the error envelope, every
     create and action takes `Idempotency-Key`, no value field outside `x-vaultix-values`
     operations.
2. **Generation is current:** run every generator, then `git diff --exit-code` on the generated
   paths.
3. **Fixture conformance:** Ajv and Go both run every fixture. As in 0126, a fixture states
   whether the schema accepts it and whether the server does.
4. **Response conformance:** Go integration tests validate every response body against its schema.
5. **After the first public release:** `oasdiff breaking` against the last `released/` copy.
6. **Capability baseline:** an inherited operation is ticked off only when it is deleted (0127).

**The AI schemas move first.** The two AI schemas and their 77 fixtures move to `schemas/ai/` and
`fixtures/ai/`. `GET /api/vx/v1/ai/schema` serves the embedded copy. The structural half of
`spec.go` becomes a call to the validator. The rules only the server applies (credential-shaped
headers, reserved header names) stay in Go, pinned by the fixtures marked `schemaValid: true,
valid: false`.

## Shared definitions to establish first

- **Resource ID.** An opaque string, UUID today, with one named definition per kind (`ProjectId`,
  `SecretId`) so generated code carries the name. Responses always include it. Slugs and names are
  mutable labels (0128 §1).
- **Ref.** `{id}` or `{slug}`: an object with both properties optional, `minProperties: 1` and
  `maxProperties: 1`. That generates a plain struct rather than a union type.
- **Secret address** (input): `{project: Ref, environment: Ref, folder: string[], name: string}`.
  - The folder is a list of segments, and `[]` is the root.
  - The name follows Doppler's permissive rules and may contain `/`, `.` and `:`.
  - The resolved form in responses adds ids: `{project:{id,slug}, environment:{id,slug},
    folder:{id,path}, name}`.
  - Google's resource names are single strings whose non-terminal segments "must not contain a
    `/`" ([AIP-122](https://google.aip.dev/122)). Doppler names break that rule, which is why the
    owner chose an object.
  - Segments also avoid shells rewriting a leading-slash path (Infisical #1595 in 0128).
  - AIP-122 itself falls back to an `_id` field "when the full name cannot be used". Vaultix stores
    references by ID and accepts the address as input only.
- **List envelope.** Request: `pageSize` (documented default and maximum) and `pageToken`.
  Response: `{items: T[], nextPageToken: string}`, where `nextPageToken` is empty only at the end.
  Using the same `items` key everywhere keeps generated generics simple.
- **Error envelope.** `{error, message, requestId, details?: {fields?: [{path, message}]}}`.
  - `error` is a stable code: a string matching `^[A-Z][A-Za-z0-9]+$`, with known codes listed in
    the schema. It is not a closed enum, so adding a code never breaks clients.
  - `path` is a JSON Pointer, which is what Ajv and the Go validator both report.
  - This replaces `reqId` and `statusCode` in `shared/types.yaml`.
- **Concurrency and retries.** Shared parameter components: `Idempotency-Key`, `If-Match`,
  `If-None-Match`, and the `ETag` response header.
- **Change set.** `{dryRun, reason?, operations[]}`.
  - Each operation has `op`: `create`, `update`, `delete`, `rename` or `move`.
  - It targets a `secretId`, or an address for `create`, with an optional `ifMatch`.
  - The result is `{changeSetId, status: planned|applied|pendingApproval|running, plan[], operation?}`,
    with one plan entry per operation: its outcome and any error.
  - If oapi-codegen handles discriminated unions badly, flatten to one object with an `op` enum,
    and let the server apply rules per `op`.
- **Event envelope.** `{id, type, occurredAt, apiVersion, subject: {kind, id}, data}`. `data`
  holds IDs, names and versions, never values. Delivery uses the Standard Webhooks headers with
  HMAC or ed25519 signatures (0127 §7).
- **Version.** `Vaultix-Version: YYYY-MM-DD` as an optional request parameter on every operation.
  The response echoes the version it served, and `Deprecation`, `Sunset` and `Link` are defined
  as response headers.

## Migration plan

Each step is one commit, verified before the next.

1. **Spike, no product change.** Bundle the common schemas and the AI schemas as 3.1. Run
   oapi-codegen-dd, openapi-typescript, Ajv standalone and santhosh-tekuri on them. Record what
   each does with type arrays, `const`, `prefixItems`, Unicode length and unions. Decide whether
   the DoorDash fork's generated `Validate()` is switched off in favour of the single validator.
2. **Create `platform/engine/api/`** with the common schemas, their fixtures, `scripts/api.mjs`
   (bundle, check, generate) and the build stage.
3. **Move the AI schemas and fixtures.** Serve them from the embedded bundle and replace the
   structural Go rules with the validator. `test-ai-contracts.mjs` folds into the api check, and
   the old files are deleted. Verify the fixtures on both sides and `test-assistant-image.mjs`.
4. **Describe the AI routes in `paths/ai.yaml`.** Generate the Go adapters, TS types, validators
   and AI MCP entries, then delete the hand-written equivalents. This fits 0126 step 4. Verify
   with the browser proof on the image.
5. **One error envelope.** Update the Go `ErrorHandler`, the TypeScript error handler, UI error
   parsing and the CLI in one change.
6. **Generate the existing MCP tools** (`vaultix.warp.list` and the rest) from schemas, and delete
   the literals.
7. **Domain by domain**, in 0122 and 0127 order: schema, generate, Go handler, move the UI, CLI,
   MCP and script callers, then delete the inherited route along with its Zod schemas and its
   per-handler `openapi.yml`. Tick the capability baseline and prove it on the image. The CLI
   client is generated when the first domain it calls moves.
8. **First public release.** Freeze `released/<date>/`, turn on the oasdiff gate, and start
   `versions.yaml`.

## Open questions for the owner

1. JSON Schema plus hand-written OpenAPI, or TypeSpec? I recommend the former now. Revisit if the
   YAML becomes the bottleneck. TypeSpec emits the same artifacts, so switching later is a
   contained change.
2. Bare UUIDs, or type-prefixed IDs (`sec_…`)? Prefixes would need a stored-data migration.
3. Should the address accept a slug, an id, or both (the `Ref` above)?
4. Folder as a list of segments: confirm. Is an output-only display string wanted, which nothing
   ever parses?
5. Which docs renderer, and is every instance's spec public or behind sign-in?
6. Should the inherited TypeScript routes get any schema work before they are deleted? I
   recommend none.

## Not verified

- How oapi-codegen-dd handles 3.1 on these schemas: its claims are 3.0-tested only. Whether it
  resolves multi-file `$ref` (bundling avoids the question). How it generates discriminated
  unions. Whether its generated validation counts characters as JSON Schema does (the 0126
  units problem).
- Whether ogen supports 3.1.
- Whether TypeSpec version enums take date strings. A search snippet showed
  `v2023_11_01: "2023-11-01"`, but the pages I read used `v1` and `v2`. Per-version OpenAPI output
  is implied, not stated.
- Whether Ajv standalone works with 2020-12 schemas: the page's examples are draft-07. The repo
  already uses `ajv/dist/2020` at runtime.
- Whether oasdiff treats a new response enum value as breaking.
- Bundler choice, docs renderers, protobuf-es, gRPC-gateway, protovalidate, prost and smithy-rs:
  not researched.
- The single-developer report is one blog post.
