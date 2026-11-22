# 0130 — The Vaultix program plan

**Execution continuation, 2026-11-21:** [0147](0147-execution-path.md) sets the
current packet order, shared patterns and retirement gates. Product obligations
below remain; dated scheduling and status do not override that path.

**Original status:** proposed for the owner's approval, 2026-11-14. **Owner:** AngryVibes LLC.
**Replaces:** the work order in [0122](0122-completion-plan.md). 0122 stays as the record of what
was found and done. Specs this plan builds on: [0125](0125-hosted-control-panel.md) (hosting),
[0126](0126-ai-configuration-schema.md) (AI), [0127](0127-one-api-infisical-as-a-source.md) (one
API, Infisical as a source), [0128](0128-api-lessons-learned.md) (API lessons),
[0129](0129-single-source-schema.md) (one schema source).

## 1. What we are building

**Vaultix is its own product. It is not Infisical and never was.** The engine started from an
Infisical fork, and everything a person or program meets becomes Vaultix's own: the API, the UI, the
design system, the names, the docs. Infisical and Doppler are products our customers move from. We
support them fully as import sources, and everyone who moves gets more, never less.

**How AngryVibes offers it** (the owner's model):

| Offering | Who runs it | What the customer gets |
| --- | --- | --- |
| **Self-hosted** | The customer | The full product and full control to deploy it themselves, under a non-compete licence: use it, run it, change it, but do not sell it as a competing hosted service. Indie developers get everything. |
| **Managed for you** | AngryVibes, through the factory | The same product deployed and operated for the customer, so they never run it themselves. |
| **Tailored hosted** | AngryVibes | Vaultix.cloud and DevSCIF: our hosted offering, one instance per customer, with plans sized to the customer. |

The **control plane, or factory,** is separate from the product. It provisions, upgrades, backs up,
monitors and retires every managed and hosted instance ([0125](0125-hosted-control-panel.md)). It
lives in `platform/shippin/`, and the product never depends on it.

## 2. Rules that do not bend

These go into AGENTS.md and are checked by the build wherever a check is possible.

1. **One API, `/api/vx/v1`**, defined once ([0129](0129-single-source-schema.md)). Every inherited
   route moves into it with its callers and is then deleted.
2. **Vaultix's own design system.**
   - **No shadcn, no Radix**, and no third-party headless or primitive kit.
   - Components are built on native HTML elements and the WAI-ARIA Authoring Practices patterns,
     styled only through Vaultix design tokens.
   - **Storybook is the source of truth.** Every component has a story, a keyboard spec and an
     accessibility test.
   - **WCAG 2.2 AA** across the whole UI.
   - A build check fails on a new `@radix-ui` import, on a colour or size written outside the
     tokens, and on a component that has no story. The number of existing Radix uses may only go
     down.
3. **The frame and every interactive element are authored, not assembled.**
   - The app frame has an icon rail, a full menu that opens out of it, and a tooltip on hover and on
     focus for every rail item.
   - Each interactive state (rest, hover, focus-visible, active, selected, disabled, busy) has its
     own token-defined style.
   - The same pieces are used across the whole app.
4. **Clyffy is part of the frame:** an overlay any page can open, built from the same primitives.
   - It works with names and references only.
   - Values never reach an AI.
5. **Show it running.**
   - Every step ends with a proof on the packaged image and a preview the owner can open.
   - UI steps also end with their Storybook stories and a browser walkthrough.
6. **Stored data always migrates.** Accounts, secrets and keys survive every upgrade.

## 3. The workstreams, in order

Each phase lists what it delivers, what it depends on, and when it is done. Phases 1 and 4 can run in
parallel. From phase 5 on, work goes domain by domain, and each domain carries the API, the screens,
the importer mapping and the parity proof together, so nothing gets done twice.

### Phase 0 — Owner decisions (before anything below starts)

- **Licence.** Which non-compete licence: the Functional Source License (FSL), BSL 1.1 with a
  non-compete grant, or the Elastic License 2.0. Counsel confirms the choice covers everything
  shipped. The licence file, notices and README follow; no licence keys, tiers or checks.
- **Brand direction for the tokens:** palette, typography, density and motion. A short set of
  references or a mood board is enough to start.
- **Schema choices** in 0129: format, ID style, addresses, folder form, docs visibility.
- **Managed for you:** our infrastructure, the customer's cloud account, or both.
- **The production host** for vaultix.cloud and the first managed instances.

### Phase 1 — The design system foundation

**Delivers:**
- **Token architecture.**
  - One token source in the W3C Design Tokens format, generating CSS custom properties and a
    TypeScript map.
  - Three layers:
    - **primitives:** the raw palette, scale and type;
    - **semantic:** surfaces, text, borders, accents, and the states rest, hover, focus-visible,
      active, selected, disabled, busy and danger;
    - **component:** the tokens each component uses.
  - Light and dark themes, reduced-motion and high-contrast variants.
  - The inherited palette names (`mineshaft`, `bunker` and the rest) are retired.
- **Primitives, each with a story, a keyboard spec, an axe test and an interaction test:**
  - **Actions:** Button, IconButton, Link.
  - **Overlays:** Tooltip, Popover, Menu and MenuButton, Dialog (native `<dialog>`), Sheet.
  - **Choices:** Tabs, Listbox, Select, Combobox, Switch, Checkbox, Radio.
  - **Forms:** Field, with label, help and error wired for assistive technology.
  - **Feedback and data:** Toast (a live region), Table, DataGrid, Empty, Skeleton.
- **Positioning and focus** are Vaultix's own small utilities: overlay placement, focus trap, roving
  tab index, dismiss on Escape or an outside press. They follow the WAI-ARIA Authoring Practices
  patterns and add no dependency.
- **The build check** described in rule 2. A new DESIGN.md replaces the inherited one, and its
  Storybook reference is generated from the stories.

**Done when:**
- Every primitive passes axe and keyboard tests in Storybook.
- The owner has reviewed them in Storybook.
- The build check is on.

### Phase 2 — The frame and Clyffy's overlay

**Depends on** phase 1.

**Delivers:**
- **The app frame:**
  - an icon rail with a tooltip on hover and focus;
  - the full menu that expands from the rail and is remembered per person;
  - the organization and project switcher;
  - breadcrumbs;
  - a command palette (Ctrl/Cmd-K);
  - notifications;
  - the account menu.
- **Clyffy's overlay**, docked in the frame and opened from anywhere. It covers chat, the persona
  picker, actions taken, memories, and the "Try it" view from 0126.
- **Responsive behaviour:** on narrow screens the rail collapses to a drawer.
- **Every existing page renders inside the new frame.** The old layouts (the nine in
  `src/layouts/`) are deleted once nothing uses them.

**Done when:**
- The frame and overlay pass Storybook tests and a browser walkthrough on the image: keyboard only,
  with a screen reader smoke pass, at 390, 1100 and 1440 px.
- The preview runs on it.

### Phase 3 — The schema foundation

**Depends on** the phase 0 schema choices. Runs in parallel with phases 1–2.

0129's steps 1–6:
1. A codegen spike to prove the Go generator works on OpenAPI 3.1, before anything relies on it.
2. Create `platform/engine/api/`, its tooling and its build stage.
3. Move the AI schemas and their fixtures into it.
4. Generate the Go handlers, UI types, validators and MCP tool list for the AI routes.
5. One error envelope everywhere.
6. Generate the MCP tools from the schemas.

**Done when** the AI domain runs entirely from generated code, and the build fails if anything drifts
from the schema.

### Phase 4 — Domains, one at a time (the bulk of the work)

**Depends on** phases 1–3.

Each domain is one sequence of changes, in this order:

1. **Design its resources** from 0128: stable IDs, structured addresses, values read separately from
   metadata, paging, errors, idempotency, conflict checks and change sets.
2. **Write the schema.** Generate the Go service, the CLI client, the UI types and the MCP tools.
3. **Build its screens** from the phase 1 primitives inside the new frame.
4. **Map it in the Infisical and Doppler importers** ([0127](0127-one-api-infisical-as-a-source.md)).
5. **Prove parity on the image** against every Infisical and Doppler capability in that domain:
   positive, denied, cross-tenant and provider-outage cases.
6. **Delete** the domain's inherited routes, Zod schemas, Radix uses and old screens.

Order, because each depends on the ones before:

1. **Identity and access:** sign-in, sessions, MFA, machine identities, roles, groups.
2. **Workspace:** organizations, projects, environments (including child environments), folders.
3. **Secrets:** addresses, values, references, imports, overrides, versions, change sets, approvals.
4. **Connect:** app connections, syncs and the importers' screens.
5. **Automation:** rotation and dynamic secrets.
6. **Governance:** audit, events and signed webhooks.
7. **KMS, PKI, PAM and detection.**

**Done when** each domain:
- has no inherited routes left;
- has its parity proof recorded;
- has its importer mapping tested.

### Phase 5 — The importers, finished

Runs inside phase 4, plus the parts that span domains:
- the import review screen, with its gaps and what to do about each;
- a dry run;
- an import into a fresh organization;
- an end-to-end proof against a copy of a real Infisical organization and a real Doppler workplace,
  using the owner's accounts entered in the UI.

**Already built:** the Infisical source adapter and the source-neutral snapshot, covering projects,
environments, folders, secrets, references and imports.

### Phase 6 — The AI, finished

0124 and 0126's remaining work, inside the new frame:
- the guard reviewing proposed changes;
- value requests, where a value only ever exists in the browser;
- native inject and redeem;
- the local endpoint;
- the `vaultix.ai.*` tools;
- a real provider and a real Hugging Face call, with the owner's keys entered in the UI.

### Phase 7 — The commercial platform

**Depends on** the phase 0 licence and hosting decisions. Parts can start alongside phase 4.

- **Licence:** the licence file and notices.
- **The factory** (0125), extended:
  - provisioning on the chosen host;
  - customer sign-up (`tenants/`);
  - per-profile quotas;
  - off-site backups;
  - monitoring and alerts;
  - billing, once the owner chooses a provider;
  - the operator console grown into the factory's control plane.
- **Managed for you:** deploying into the customer's environment, if the owner chooses that.
- **Tailored hosted:** vaultix.cloud and DevSCIF on their own instances, with 0054's release gates:
  - tenant isolation;
  - durability;
  - quotas;
  - measured capacity;
  - restore;
  - availability.

### Phase 8 — The first public release

- Freeze the spec. The `Vaultix-Version` header and the 24-month support policy take effect.
- The breaking-change check turns on.
- Publish the docs and the migration guides from Infisical and Doppler.
- From then on, deprecation follows 0127.

## 4. How each change is made

- **One change does one verifiable thing.** It ships with its stories, its tests, its proof on the
  packaged image, a preview the owner can open, and its docs. Nothing is called done from unit
  tests alone.
- **UI work starts in Storybook,** gets the owner's review there, and then goes into the app. No
  screen is built from an inherited component.
- **Every claim of parity names its proof.** "Built" and "proven" are never the same word.

## 5. What exists today, against this plan

| Area | State |
| --- | --- |
| API | `/api/vx/v1` exists for AI, access, connect, warp points and a few more. About 1,570 inherited operations remain. |
| Schema | The AI domain has v1 JSON Schemas shared by Go and the UI, but Go repeats their rules by hand. Phase 3 replaces that. |
| UI | Storybook runs with 53 stories, but the components are shadcn-style wrappers over Radix: 17 Radix packages, imported directly in 45 files. The palette and DESIGN.md are inherited. The frame is the inherited layouts. Phases 1–2 replace all of this. |
| Clyffy | A chat panel and the Admin › AI page (connections, personas, routing, memories, try it) work on the image. Both move into the new frame in phase 2. |
| Importers | The Doppler and "external Vaultix" import works. The Infisical adapter reads into the snapshot but does not yet write into Vaultix. |
| Factory | The fleet record, the operator console and scheduled backups exist in `platform/shippin/`. |
| Instance lifecycle | Install, upgrade, recover, rollback, backup and owner recovery are proven. |

## 6. Owner decisions, all in one place

1. **Licence:** FSL, BSL 1.1 with a non-compete grant, or Elastic 2.0, confirmed with counsel.
2. **Brand references** for the tokens.
3. **0129's six schema questions:** format, ID style, address form, folder form, docs visibility,
   and whether inherited routes get any schema work.
4. **Managed for you:** our infrastructure, the customer's, or both.
5. **The production host** and the region or regions.
6. **The billing provider.**
7. **Plan sizes and prices** for the tailored hosted offering.
