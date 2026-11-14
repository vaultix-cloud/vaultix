# 0127 — One Vaultix API; Infisical is a source we import from

**Status:** accepted (owner, 2026-11-14). **Changes:** [0121](0121-provider-import.md),
[0023](0023-capability-convergence.md), [0026](0026-capability-preservation.md), and Stage 7 of
[0122](0122-completion-plan.md). Where they differ, this wins.

## Decision

1. **Vaultix has one API: `/api/vx/v1/<domain>`** ([0119](0119-schema-and-api-namespaces.md)).
   - Every inherited route (`/api/v1` to `/api/v4`, about 1,570 operations, shaped like Infisical's
     because the engine was forked from it) moves under the Vaultix API, domain by domain. The old
     route is deleted in the same change, with every caller moved: the UI, CLI, MCP tools, scripts,
     tests and docs.
   - No Infisical-compatible routes are kept, and there are no aliases.
   - Vaultix's own clients (the web app, `vaultix`, MCP, the SDKs) are the supported way in.
2. **Infisical is a third-party source.** Customers move their data from Infisical with a dedicated
   Infisical connector. It speaks Infisical's own public API, signing in as an Infisical machine
   identity. It does not depend on Vaultix still speaking that API. Vaultix-to-Vaultix import uses
   the Vaultix API. Doppler stays a third-party source as it is.
3. **More, never less.** A customer who moves from Infisical (or Doppler) loses nothing:
   - Every Infisical capability has a Vaultix equivalent, proven on the image, before Vaultix is
     offered to Infisical customers.
   - The import brings over every kind of object Infisical holds, not only secret values.
   - Anything it cannot bring is named in the review, with the reason and what to do instead.
     Nothing is dropped silently.

## What changes

### The API (0122 Stage 7, now the only target)

- **Moving a domain means redesigning it, not renaming its paths.** A domain gets its own Vaultix
  resource model, informed by what has hurt Infisical and Doppler users
  ([0128](0128-api-lessons-learned.md), research pending the owner's review). It is not
  Infisical's shape under a new prefix.
- **Before the first public release**, old routes are deleted outright, because no outside client
  depends on them.
- **After the first public release**, a change that breaks clients follows a published deprecation
  policy: a notice, a sunset date, and an upgrade guide. That is a commitment to Vaultix's own
  customers, not to another product's API.

- The inherited API's capability baseline (`contracts/vaultix-capability-surface.v1.json`) stops
  being something to preserve. It becomes the work list: each inherited operation is checked off
  only when its use case runs on the Vaultix API, its caller has moved, and the old operation is
  gone.
- Its order stays foundation, identity, authorization, secrets, then the rest.
- The UI, CLI and MCP keep working at every step, because each move takes their callers with it.

### Importing from Infisical (0121 extended)

- **Every source version lands on the latest Vaultix model.** Each source has its own adapter,
  which reads whatever the source's API returns, such as Infisical's older and newer secret
  endpoints or Doppler's root and branch configs. The adapter translates it into one internal model
  and writes the current Vaultix form. When Vaultix changes, only the adapter's mapping changes;
  nothing of the source's shape leaks into Vaultix.

- **Connection.** A new `infisical` provider with its own app connection: the Infisical address
  (Cloud US, Cloud EU, or self-hosted), plus a machine identity's Universal Auth client ID and
  secret, entered in the UI and encrypted like every connection.
- **Review first, then import exactly what was approved.** The review lists, per kind, what
  exists, what will be created, and what cannot come over and why. Values never leave the server
  and never reach a response, the UI, chat or an AI. As today, a stale review is refused and
  governed paths open change requests.
- **Kinds covered**, built in this order, with each one proven before the next:
  1. Projects and environments.
  2. Folders.
  3. Secrets: values, comments, tags and metadata. References are rewritten to their Vaultix
     form.
  4. Secret imports.
  5. Personal overrides.
  6. Version history, where Infisical's API returns it.
  7. Roles and their permissions.
  8. Machine identities and their auth methods. Credentials are not copied: the review says which
     ones to issue again.
  9. Groups and memberships, by email.
  10. Approval policies and access-request policies.
  11. Secret rotation and dynamic secret configurations. Provider credentials are re-entered by the
      owner.
  12. Secret syncs and integrations, as configurations, with their app connections to re-enter.
  13. Webhooks.
  14. PKI (CAs, templates, alerts). Private keys come over only where Infisical exports them;
      otherwise the review says to re-issue.
  15. KMS keys, where exportable.
  16. Audit log export, for the customer's records.
- **Credentials held by third parties** (cloud keys, database passwords inside dynamic secrets,
  SMTP, sync targets) cannot be read through Infisical's API by design. The review names each one
  and where to enter it in Vaultix.

### Coverage (0023 and 0122 Stage 4c)

- The capability matrix in 0023 becomes the "more, never less" gate.
- Every row needs:
  - a Vaultix workflow proven on the image (positive, denied, cross-tenant, provider outage);
  - an import path, or a named, deliberate gap the owner has accepted.
- Gaps known today: Terraform provider, Kubernetes operator, typed values, and the families with no
  test (0122 Stage 4c).

## API decisions (owner, 2026-11-14, from [0128](0128-api-lessons-learned.md))

1. **Errors.** `error` is a stable code that programs check. `message` is the human sentence, and
   its wording can improve without breaking anyone. Every error also carries `requestId`, and
   validation errors carry `details.fields[{path, message}]`.
2. **Secret address.** An address is a structured object `{project, environment, folder, name}`,
   never one string to parse; Doppler names may contain `/`, `.` and `:`. How that schema is
   defined once and shared by everything that uses it is being researched in
   [0129](0129-single-source-schema.md), aimed at one developer maintaining it.
3. **Doppler branch configs** import as child environments that inherit from their parent, so
   Doppler customers keep the model they know.
4. **Import precedence.** By default the last import wins, matching Infisical. A project setting
   switches to first-wins, matching Doppler. Importers translate either way. (Read from the owner's
   answer; confirm if the default should be first-wins instead.)
5. **Versions.** After the first public release, breaking changes go behind a dated
   `Vaultix-Version` header, with 24 months of support per version. Retired versions answer 410.
   `Deprecation` and `Sunset` headers announce changes ahead of time.
6. **Reading values.** An environment can require a stated reason to read a value, recorded in the
   audit log. It is optional per environment and offered for production first.
7. **Webhook signing.** Both HMAC and ed25519, so a receiver can verify without holding a shared
   secret.

## Done when

1. No route outside `/api/vx/v1` remains, and the old capability baseline is empty.
2. A copy of a real Infisical organization imports into Vaultix with every kind above either
   brought over or named in the review. The owner's checklist compares the two side by side.
3. Every Infisical capability in 0023 has a Vaultix workflow proven on the image.
