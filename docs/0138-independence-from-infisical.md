# 0138: Becoming its own product, measured

**Status:** direction set by the owner 2026-11-15: Vaultix began as an Infisical fork and must end as its own product,
with one clean v1 API, nothing inherited, the lessons from Infisical's complaints and OpenBao's design built in, and the
chat and custom LLM as part of one platform. **Builds on:** 0127 (one API, Infisical as an import source), 0136
(kernel, platform, control), 0137 (Zod retirement).

## 1. Where it stands (`node scripts/lineage-census.mjs`, against the import commit 1da705e0)

12,575 tracked files: **9,387 (74.6%) are byte-identical to the import**, 1,762 (14.0%) are modified inherited files, and
1,426 (11.3%) were written here. The identical files are the frontend (3,919), the backend (2,863), the engine's own docs
(1,653) and assorted root files (785). The name is mostly gone (52 files mention it, and customer chrome is gated by
`scripts/check-owned.sh`), but the code is not: today this is a fork with a large authored layer, and should be described
that way until the number falls.

## 2. What "its own product" means, as checks

| Claim | Check | State |
| --- | --- | --- |
| No inherited code in the new tree | `kernel/`, `control/`, `platform/shippin/` have zero inherited files (`check-kernel-boundaries.mjs`, and the census shows them as authored) | holds |
| Inherited code only shrinks | `scripts/lineage-ceiling.json`, `lineage-census.mjs --check`, lowered in every commit that deletes or rewrites | new, 9,387 |
| One API, no Infisical routes | 0127; the capability-surface baseline | in progress |
| No Infisical-shaped schema or library | Zod count (0137), ArkType documents (0136) | in progress |
| Customer-facing names | `scripts/check-owned.sh` | holds |
| Infisical is an import source only | the importer under `backend-go/internal/services/importer/infisical` | holds |

## 3. Honest limits

- Until the identical count is near zero, the tree still contains someone else's code. Notices that its licence requires
  must stay with it (AGENTS: third-party notices stay), and public wording should say "originally forked from Infisical"
  rather than imply a clean-room origin. Removing the notice is only correct after the last inherited file is gone.
- "Byte-identical" is a floor for inherited work: a modified file can still be mostly the original. The census cannot say
  how much of a modified file is original, so the 1,762 are not counted as authored.
- Rewriting is not the goal in itself. A file that is deleted because its domain moved into the kernel counts the same as
  one rewritten, and costs less.

## 4. What makes it a different product, not a rewrite of the same one

The complaints and the OpenBao ideas are already the design of the kernel (0134, 0136): a secret type that cannot be
printed, a single audit chain written in the same transaction, fail-closed gates, events instead of polling, one Postgres
store, leases and single-use handles. This document does not repeat them. It adds the part that was missing, which is the
measurement of how much of the old product is left and a rule that the number only falls.

## 5. Next

1. Zod to ArkType (0137, route B) deletes or rewrites the largest block: the backend and frontend schemas.
2. Move each backend domain into the kernel and delete it (0130 order), lowering the ceiling each time.
3. Rewrite the frontend screens from Vaultix primitives (no inherited component as a starting point, per AGENTS).
4. Replace `platform/engine/docs` (2,325 files, 1,653 identical) with Vaultix's own documentation.
5. When identical reaches zero and modified is small, remove the notice only with the owner's decision on licence.

## 6. Review: what to rewrite first (`node scripts/lineage-domains.mjs`, 2026-11-15)

Code files only (no tests or stories) in the backend services and routes and the frontend pages and API hooks: 270
domains, **436,163 lines still byte-identical to the import**. The distribution decides the order.

| Block | Identical lines | What it is | Recommendation |
| --- | --- | --- | --- |
| Frontend pages: secret-manager 91k, organization 64k, project 20k, user/auth/admin 8k | about 183k | The screens a customer lives in | Rewrite from Vaultix primitives, screen by screen, behind the app frame (0131). The biggest single block, and the one the owner sees |
| Frontend pages: cert-manager 56k, pam 21k, kms 4k, secret-scanning 4k | about 85k | Infisical's expansion products | Must exist in Vaultix (0127: more, never less) but are not the core. Sequence them after the core; the open PKI and PAM scope question changes the order, not whether they exist |
| Connectors: app-connection (455 files, 25k), secret-sync (16k), pki-sync (7k), integration-auth (3k), with their frontend hooks (about 11k) | about 62k | One file group per provider (AWS, GitHub, and so on) | Not 450 rewrites. One declarative connector framework in the kernel (a spec per provider; shared auth, sync, retry, audit), then each provider is data plus its API calls. The largest drop in file count per unit of work |
| Backend: certificate-authority (11k), certificate, certificate-profile, signer, pki-alert-v2 | about 18k | PKI services | Move with cert-manager above |
| Backend: smtp, alert, approval-policy, org, project, secret services | about 15k | Core services | Into the kernel by domain (0130), then delete |
| Backend routes v1/v2 | about 11k identical of 61k | The old API | Deleted as each domain gets its `/api/vx/v1` route (0127) |

Three observations that were not obvious before measuring:

1. **The frontend is 58% of the inherited lines in these groups, not the backend.** The first five page groups alone are
   about 252k of 436k. The kernel work removes the backend's risk, and the screens remove the upstream's footprint.
2. **Connectors are a different kind of work.** 455 of the 491 app-connection files are byte-identical, and they differ by
   provider, not by logic. A framework removes them in one move; rewriting each by hand would be the slowest path.
3. **Routes are mostly already edited** (176 of 286 v1 route files identical, but 55k lines in the group), so route
   deletion follows the domain moves and needs no separate project.

Order proposed: (1) the connector framework and the secrets, projects and org domains into the kernel, with their
screens; (2) identity and auth screens; (3) PKI and KMS; (4) PAM and scanning. Each step lowers
`scripts/lineage-ceiling.json`. Nothing here has been rewritten yet; this is the map.
