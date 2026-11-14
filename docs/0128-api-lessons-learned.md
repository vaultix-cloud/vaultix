# 0128 — API lessons from Infisical, Doppler and mature APIs

**Status:** research 2026-11-14, by AI, for owner review; not yet a decision.
**Relates to:** [0119](0119-schema-and-api-namespaces.md) (the `/api/vx/v1/<domain>` API),
[0121](0121-provider-import.md) and [0127](0127-one-api-infisical-as-a-source.md) (import).

Every claim below links to the page it came from. Where a source was third-party, or I could
not confirm something, the text says so. A list of unverified points is at the end.

## What hurt Infisical users

- **Four generations of secrets endpoints, versioned per endpoint.** Infisical tells callers to
  "use the highest version listed" for each endpoint, and adds a new version while keeping the old
  one ([API introduction](https://infisical.com/docs/api-reference/overview/introduction)). The
  v3 raw endpoints are now marked deprecated in favour of `/api/v4/secrets`
  ([v3 list, deprecated](https://infisical.com/docs/api-reference/endpoints/deprecated/secrets/list)).
  I found no published removal date or migration guide.
- **The same request means different things in different versions.** v3 list defaults
  `expandSecretReferences` and `include_imports` to false
  ([v3](https://infisical.com/docs/api-reference/endpoints/deprecated/secrets/list)); v4 defaults
  `expandSecretReferences` and `includeImports` to true
  ([v4](https://infisical.com/docs/api-reference/endpoints/secrets/list)). Reference resolution
  also changed: under v4, `${KEY}` inside an imported secret resolves against the importing
  environment first, while "older versions always resolve local references against the source
  environment" ([secret references](https://infisical.com/docs/documentation/platform/secret-reference)).
  A client that bumps the path gets different values without any error.
- **Naming drift inside one version.** Both `GET /api/v1/workspace/{workspaceId}`
  ([doc](https://infisical.com/docs/api-reference/endpoints/deprecated/projects/get-project)) and
  `GET /api/v1/projects/{projectId}` ([doc](https://infisical.com/docs/api-reference/endpoints/projects/get-project))
  exist at v1. The v3 list took `workspaceId`, plus a `workspaceSlug` only machine identities could
  use, and mixed `include_imports` (snake case) with camelCase parameters. The v4 response still
  carries `workspace`, `_id` and `id` on each secret ([v4](https://infisical.com/docs/api-reference/endpoints/secrets/list)).
- **Values by default.** Both v3 and v4 list return values unless the caller sends
  `viewSecretValue=false` (same pages). Reading metadata and reading values are one call.
- **Addressing is four loose parameters.** A secret is `projectId`, environment slug,
  `secretPath` and name, passed separately. Paths as arguments break in odd places: Git Bash rewrote
  `--path="/account"` to `C:/Program Files/Git/account`, and the issue was closed as a shell
  problem ([#1595](https://github.com/Infisical/infisical/issues/1595)).
- **Pagination is uneven.** The introduction says paginated endpoints use `offset` and `limit`
  ([intro](https://infisical.com/docs/api-reference/overview/introduction)), but the v4 secrets
  list spec has no pagination at all ([v4](https://infisical.com/docs/api-reference/endpoints/secrets/list)).
- **Encryption design leaked into the API.** Before mid-2023, apps had to "manually fetch back
  encrypted secrets and perform cumbersome, client-side decryption"; plaintext endpoints were added
  as an option ([June 2023 update](https://infisical.com/blog/infisical-update-june-2023)). Older
  schemas carry fields like `secretKeyCiphertext` and `secretKeyIV`
  ([third-party spec mirror](https://apis.io/apis/infisical/infisical-secrets-api/)).
- **Credential types replaced twice.** API keys and service tokens gave way to machine identities
  because automation needed both token kinds, every project needed its own service token, and both
  were static ([introducing machine identities](https://infisical.com/blog/introducing-machine-identities)).
  Service tokens are documented as deprecated
  ([machine identities](https://infisical.com/docs/documentation/platform/identities/machine-identities)).
  A shutdown date of 2025-07-30 appears in search snippets of Infisical's deprecation post, but the
  post returned 404 when I fetched it, so the date is unverified.
- **Reference sharp edges.** There is no escape for `${...}` text that is not a reference; the
  request was closed "not planned" ([#1637](https://github.com/Infisical/infisical/issues/1637)).
  Only one level of imports is searched, cross-project references are not expanded recursively,
  and a missing permission leaves a reference unresolved
  ([secret references](https://infisical.com/docs/documentation/platform/secret-reference)).
- **SDK churn.** `infisical-node` became legacy in favour of `@infisical/sdk`, and "all versions
  prior to 4.0.0 are officially fully unsupported" ([Node SDK](https://infisical.com/docs/sdks/languages/node)).
- **Rate limits are hard to program against.** Cloud returns 429 with
  `"error": "RateLimitExceeded"` and the wait time inside the message text; no rate-limit headers
  are documented, and self-hosted has no limits by default
  ([rate limits](https://infisical.com/docs/api-reference/overview/rate-limits)).
- **What worked:** a consistent error body with `reqId`, `statusCode`, a stable `error` class and
  `message` ([errors](https://infisical.com/docs/api-reference/overview/errors)). Its weak spot is
  that `message` is sometimes a string and sometimes an array.

## What hurt Doppler users

- **One service token per config.** A service token reads one config of one project
  ([service tokens](https://docs.doppler.com/docs/service-tokens)). Monorepo users needed "24
  different doppler tokens", and one team fell back to personal tokens, "the opposite to secure".
  Service Accounts that span configs arrived later and need the Team plan
  ([forum thread, 2022–2024](https://community.doppler.com/t/monorepo-access-token-setup-tedious/599)).
- **References break on rename.** Renaming a referenced secret leaves the reference unresolved;
  staff called it "a definite pain point", and the 2024 answer was config inheritance instead
  ([thread](https://community.doppler.com/t/updating-referenced-secret-names-updates-references/431)).
  Nested references are not supported ([thread, 2023](https://community.doppler.com/t/reference-the-secrets-from-other-reference/1365)).
- **References resolve into less protected places.** When a config synced to AWS Parameter Store
  referenced a secret from a more sensitive config, the resolved value landed in Parameter Store.
  Doppler said this is by design ([thread, 2023](https://community.doppler.com/t/secrets-referencing-stores-raw-value-to-integration-store/1096)).
- **Three overlapping ways to share values.** Branch configs overlay a root config
  ([branch configs](https://docs.doppler.com/docs/branch-configs)); config inheritance pulls from
  ordered parents, where "the topmost config will always take precedence", and does not support
  dynamic secrets ([config inheritance](https://docs.doppler.com/docs/config-inheritance)); and
  references cut across both. Infisical's imports use the opposite order: the bottom-most import
  wins ([secret references](https://infisical.com/docs/documentation/platform/secret-reference)).
- **One write endpoint, two body shapes.** Secrets update takes either a `secrets` map or a
  `change_requests` array, never both. `null` means "leave unchanged", deletes use
  `shouldDelete`, renames are inferred from `originalName` (marked required in the schema but
  described as optional), and the precondition `originalValue` makes the caller send the old value
  ([secrets update](https://docs.doppler.com/reference/secrets-update)).
- **Restricted values are unevenly readable.** They never show in the dashboard again, and via
  API or CLI only with a non-user token; personal and CLI tokens get `null`
  ([visibility](https://docs.doppler.com/docs/visibility-types)).
- **Little written policy.** The API is `/v3/...` with no versioning or deprecation policy that I
  found, and no documented error body ([API reference](https://docs.doppler.com/reference/api)).
  A third-party Go client models errors as `success` plus `messages`
  ([doppler-go](https://pkg.go.dev/github.com/nikoksr/doppler-go@v0.3.0)); unconfirmed by Doppler.
- **What worked:** rate-limit headers including `retry-after` ([API reference](https://docs.doppler.com/reference/api));
  webhook payloads that list changed secret names rather than values, HMAC signing in
  `X-Doppler-Signature`, and retries ([webhooks](https://docs.doppler.com/docs/webhooks)), though
  signing only happens if a secret was configured; `raw` and `computed` values side by side
  ([secrets list](https://docs.doppler.com/reference/secrets-list)); typed values with validation
  (`json`, `integer`, `url` and others) ([secrets update](https://docs.doppler.com/reference/secrets-update)).

## How mature APIs evolve without breaking people

- **Stripe** pins each account to the version current at its first request, names versions by
  date, lets a request override with `Stripe-Version`, and implements each breaking change as a
  "version change module" that transforms responses back to older versions
  ([Stripe blog](https://stripe.com/blog/api-versioning)). Since 2024-09-30 it ships monthly
  versions with no breaking changes and two named major releases a year
  ([versioning](https://docs.stripe.com/api/versioning)). Idempotency keys are kept at least 24
  hours, and a reused key with different parameters is an error
  ([idempotent requests](https://docs.stripe.com/api/idempotent_requests)).
- **GitHub** uses an `X-GitHub-Api-Version` date header, defaults to `2022-11-28`, supports each
  version 24 months after its successor, answers retired versions with `410 Gone`, and publishes
  an explicit list of breaking versus additive changes
  ([API versions](https://docs.github.com/en/rest/about-the-rest-api/api-versions)).
- **Google AIPs**: page tokens must be opaque and adding pagination later is a breaking change
  ([AIP-158](https://google.aip.dev/158)); errors carry a stable reason and machine-readable
  metadata, and permission is checked before existence ([AIP-193](https://google.aip.dev/193));
  request IDs make retries idempotent ([AIP-155](https://google.aip.dev/155)); etags guard writes
  and a mismatch is `ABORTED` (409) ([AIP-154](https://google.aip.dev/154)); updates are `PATCH`
  with field masks ([AIP-134](https://google.aip.dev/134)); slow work returns an operation to poll
  ([AIP-151](https://google.aip.dev/151)); resource names are canonical and stored by clients
  ([AIP-122](https://google.aip.dev/122)); beta gets about 180 days of deprecation
  ([AIP-185](https://google.aip.dev/185)).
- **Microsoft (Azure)** requires an `api-version=YYYY-MM-DD` query parameter on every call,
  returns `{error:{code,message,target,details,innererror}}` with a matching `x-ms-error-code`
  header, paginates with `value` plus `nextLink`, uses `Repeatability-Request-ID` for safe POST
  retries and `If-Match` with 412 for concurrency
  ([Azure guidelines](https://github.com/microsoft/api-guidelines/blob/vNext/azure/Guidelines.md)).
- **Standards.** The `Deprecation` header became a Standards Track RFC in March 2025, with
  `Link rel="deprecation"` pointing at a migration guide ([RFC 9745](https://www.rfc-editor.org/rfc/rfc9745.html));
  `Sunset` gives the shutoff date ([RFC 8594](https://www.rfc-editor.org/rfc/rfc8594.html)).
  Problem details define `application/problem+json` ([RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html)).
  The `Idempotency-Key` header is still an Internet-Draft, revision 08 as of October 2026, with
  422 for a reused key and 409 for an in-flight duplicate
  ([draft](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/)).
  Standard Webhooks signs `id.timestamp.payload` with HMAC-SHA256 or ed25519 and describes thin
  payloads (identifiers only) as a way to keep access controlled and auditable ([spec](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md)).

**Adopt:** GitHub's date header and written breaking-change list; Google's opaque cursors,
stable error reasons, etags and permission-before-existence; Stripe's idempotency rules; the
Deprecation, Sunset and `Link` headers; Standard Webhooks signing.

**Do not adopt, or not yet:** Stripe's per-account pinning and transformation modules. Every
Vaultix customer runs their own instance (AGENTS.md), so the instance release is already the
pin; transformation modules are worth building only when the first breaking change after release
actually happens. Azure's mandatory query parameter adds noise to every call and clashes with
the path version Vaultix already has. Full `problem+json` is optional; Vaultix's envelope can
stay as is if it maps cleanly (see 5).

**Keeping a competitor's API shape.** Compatible APIs exist where a wire protocol is the market:
R2 implements S3 but "has removed some API operations' features and added others"
([R2](https://developers.cloudflare.com/r2/api/s3/api/)), and Anthropic's OpenAI-compatible layer
is "not considered a long-term or production-ready solution" and silently ignores most
unsupported fields ([Anthropic](https://platform.claude.com/docs/en/api/openai-sdk)). A secrets
API is not such a protocol, and a partial clone inherits the other side's mistakes. That supports
0127: import from Infisical, do not imitate it.

## Recommendations for the Vaultix API

1. **One resource model, one name per concept.** Organization, project, environment, folder,
   secret, version. Every resource has an immutable opaque ID; slugs and names are mutable labels.
   Responses always return the ID ([AIP-122](https://google.aip.dev/122)). One spelling everywhere
   (`project`, never `workspace`), camelCase for every field and parameter, no `_id` beside `id`.
   A field is never renamed within a version.
2. **Address secrets two ways only.** By ID, `/api/vx/v1/secrets/secrets/{secretId}`, or by one
   structured address object `{project, environment, folder, name}` in a request body, never four
   loose query parameters. Publish one canonical address string for humans, CLI and references
   (exact syntax is an open question), and return it on every secret. Store references as the
   target's ID and render the text on read, so renames never break them (Doppler's rename pain),
   provide an escape for literal `${` (Infisical #1637), and make a pinned version explicit rather
   than implied by the API version (Infisical v3 versus v4 resolution).
3. **Values are a separate action.** List and get return metadata only, as AGENTS.md already
   requires; values leave only through an explicit access or redeem action, which needs its own
   permission (compare Google's Viewer versus Secret Accessor,
   [access control](https://docs.cloud.google.com/secret-manager/docs/access-control), and Vault
   KV v2 `/data` versus `/metadata`, [KV v2](https://developer.hashicorp.com/vault/api-docs/secret/kv/kv-v2)).
   Every value read is audited with the actor, secret IDs and version, never the value. There is
   no `viewSecretValue=true` default anywhere. A bulk runtime export is the same action, audited.
4. **Paginate every list from the first release.** `pageSize` with a documented default and
   maximum, opaque `pageToken`, and `nextPageToken` empty only at the end
   ([AIP-158](https://google.aip.dev/158)). No offsets.
5. **One error envelope everywhere.** Keep the plain `error` string and extend it to:
   `error` (stable code, as 0121 already does with `StaleImportReview`), `message` (one human
   sentence, always a string), `requestId`, and `details`, with `details.fields[{path,message}]`
   generalised from the AI domain to every validation failure. Check permission before existence
   so a 404 never confirms a secret name exists ([AIP-193](https://google.aip.dev/193)). Send
   limit, remaining and reset headers plus `Retry-After` on 429, as Doppler does.
6. **Idempotency and concurrency.** Accept `Idempotency-Key` on every create and action; keep keys
   at least 24 hours; 422 on reuse with a different body, 409 while the first is in flight
   ([draft](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/),
   [Stripe](https://docs.stripe.com/api/idempotent_requests)). Return an `ETag` derived from the
   secret's version and honour `If-Match` (412 on mismatch) and `If-None-Match: *` for
   create-only, like Vault's `cas` ([KV v2](https://developer.hashicorp.com/vault/api-docs/secret/kv/kv-v2)).
   Never make a precondition that requires sending the old value (Doppler's `originalValue`).
7. **Bulk changes as one change set.** A single change-set resource: an ordered list of create,
   update, delete, rename and move operations, validated as a whole, applied all or nothing.
   `dryRun` returns the plan by name, as the import review does today. On a governed path the same
   change set becomes the approval request, so there is no second body shape. Large sets return an
   operation to poll ([AIP-151](https://google.aip.dev/151)).
8. **Events and webhooks.** Thin payloads: event ID, type, resource IDs, names and versions, never
   values ([Standard Webhooks](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md)).
   Signing is mandatory, not optional as at Doppler. At-least-once delivery with the event ID for
   de-duplication, a visible delivery log and redelivery. Event payloads follow the API version.
9. **Tokens.** One machine-identity model whose grants can span projects and environments, so no
   one needs a token per config. Long-lived client credentials or workload identity are exchanged
   for short-lived access tokens; personal tokens are not for CI. A `whoami` endpoint describes the
   current token's scope and expiry.
10. **Versioning after the first public release.** Until then, keep deleting old routes outright
    (AGENTS.md, 2026-11-11). After it, keep `/api/vx/v1` as the major version, ship additive
    changes freely, and put breaking changes behind a dated version header (name to be decided,
    for example `Vaultix-Version: 2027-03-01`), using GitHub's breaking-change list. Publish a
    support window, answer retired versions with 410, and emit `Deprecation`, `Sunset` and
    `Link rel="deprecation"` on anything scheduled to go. Because self-hosted instances run
    different releases, add a discovery endpoint that lists supported versions and capabilities,
    so CLIs and SDKs can adapt or refuse clearly.
11. **OpenAPI is generated, and gates CI.** Generate the OpenAPI document from the route schemas,
    diff it in CI, and fail on any change in GitHub's breaking list without a version entry.
    Generate SDKs and the MCP tool list from the same document (AGENTS.md: MCP tools are the
    source actions), and have each SDK pin the API version it was generated against, as Stripe's
    newer SDKs do ([versioning](https://docs.stripe.com/api/versioning)). That avoids Infisical's
    "rewrite the SDK, older versions unsupported" pattern.

## Importing from Infisical and Doppler

Build each importer as an anti-corruption layer: a source adapter reads the provider's own API
and emits one normalized, versioned model (the current Vaultix model); only that model touches
Vaultix services. Adapters record which source version they read, because the same text can mean
different things.

**Infisical.** Read v4 where available with every default spelled out:
`expandSecretReferences=false`, `includeImports=false`, `includePersonalOverrides` read
separately, `recursive=false` per folder. Fall back to v3 raw on older servers, sending the same
flags explicitly. Projects created with end-to-end encryption may need Infisical's project
upgrade first; I could not confirm whether raw endpoints serve them, so treat them as
`unreadable` with that instruction.

| Infisical | Vaultix |
| --- | --- |
| project (`workspaceId` or `projectId`) | project |
| environment slug | environment |
| `secretPath` | folder |
| shared secret, comment, tags, metadata | secret, comment, tags, metadata |
| personal secret | personal override, matched to a user by email |
| secret import (bottom-most wins) | ordered import with precedence stated explicitly |
| `${KEY}`, `${env.path.KEY}`, `${@project.env.path.KEY}` | structured reference by target ID, resolved with v3 or v4 rules as recorded |

**Doppler.** Use a service token or service-account token, because personal and CLI tokens get
`null` for restricted values ([visibility](https://docs.doppler.com/docs/visibility-types)). Read
`raw`, never `computed`, so references survive. Exclude Doppler-managed secrets
(`include_managed_secrets` defaults to true) and do not request dynamic secrets, which issue
leases ([secrets list](https://docs.doppler.com/reference/secrets-list)).

| Doppler | Vaultix |
| --- | --- |
| project, environment | project, environment |
| root config | the environment's base folder |
| branch config | open question: a child folder that imports the base, or its own environment |
| personal config (`dev_personal`) | personal overrides |
| config inheritance (topmost wins) | ordered imports, order reversed if Vaultix keeps bottom-most wins |
| `${KEY}`, `${config.KEY}`, `${project.config.KEY}` ([secrets](https://docs.doppler.com/docs/secrets)) | structured reference; note `${a.KEY}` means a config here and an environment in Infisical |
| note, value type, visibility | comment, typed value, sensitivity (restricted becomes write-only) |

**What cannot be read.** Third-party credentials held by either product: machine identity client
secrets, app-connection and sync credentials, dynamic-secret and rotation root credentials, SSO
and SCIM secrets, and Doppler service tokens. I did not confirm each against their APIs, but the
precedent is clear: Infisical's own Vault importer says "Sensitive values like service account
JWTs can't be retrieved from Vault" and asks for re-entry
([Vault import](https://infisical.com/docs/documentation/platform/external-migrations/vault)),
and Doppler can import automatically only when the source API "supports reading secrets in plain
text" ([importing](https://docs.doppler.com/docs/importing-secrets)).

**How to report it.** Extend the 0121 review statuses (`create`, `exists`, `denied`,
`unreadable`) with `unsupported` and `reissue`, each with a stable reason code, the source
location, and the action to take. Offer the review as a downloadable report, carried into the
audit log. Infisical's Doppler importer does not say how references or duplicates are handled
([doc](https://infisical.com/docs/documentation/platform/external-migrations/doppler)); Vaultix
should state both.

## Open questions for the owner

1. Is `error` a stable code (as `StaleImportReview` is) or a human sentence? Recommendation 5
   assumes a code plus `message`.
2. The canonical secret address syntax, given that Doppler permissive names may contain `/`, `.`
   and `:`.
3. Branch configs: child folders, child environments, or a new "variant" concept?
4. Import precedence: keep Infisical's bottom-most-wins, or switch to topmost-wins like Doppler?
5. Version header name and support window after release (GitHub uses 24 months).
6. Should a value read require a stated reason for some environments, recorded in audit?
7. Webhook signing: HMAC only, or also ed25519 so receivers hold no shared secret?

## Not verified

- Infisical's service-token and API-key shutdown date (2025-07-30): the post returned 404.
- When Infisical's v4 secrets API shipped and whether v3 has a removal date.
- Whether Infisical raw endpoints read non-upgraded end-to-end-encrypted projects.
- Doppler's error body shape (third-party client only) and whether branch configs can nest.
- Which third-party credentials each product's API refuses to return, item by item.
