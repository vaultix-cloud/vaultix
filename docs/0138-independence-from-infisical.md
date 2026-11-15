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
