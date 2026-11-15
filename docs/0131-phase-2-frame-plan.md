# 0131: Phase 2 plan, the frame around the real app

**Status:** proposed, 2026-11-15. **Parent:** `docs/0130-vaultix-program-plan.md`, phase 2.
**Built on:** the phase 1 design system (`platform/engine/DESIGN.md`).

Phase 2 puts every signed-in page inside the Vaultix frame and adds the switcher, breadcrumbs,
command palette, notifications, account menu and Clyffy's overlay. This plan is grounded in an
inventory of the inherited shell taken on 2026-11-15; it ends with the decisions the owner needs
to make.

## 1. What is there today

- **One shell.** Org and project navigation comes from `layouts/OrganizationLayout`: a top bar
  (`NavBar/Navbar.tsx`, 730 lines) and a sidebar (`OrgSidebar/`) that swaps between three
  bodies (organization, product listing, project). `AdminLayout` reuses the top bar and adds its
  own sidebar. The five product layouts (secret manager, certificates, KMS, secret scanning, PAM)
  render no navigation at all; they only add banners.
- **Drill-down submenus.** Settings, access control, certificate integrations and approvals open
  as sidebar submenus whose items are `?selectedTab=` links into the same page.
- **The top bar holds:**
  - the org switcher (with sub-organizations and SSO hand-off) and the product, project and
    application pickers;
  - Clyffy, the version badge, the Server Console link and Invite Users;
  - the Help menu, What's New and notifications;
  - the user menu.
- **Breadcrumb data exists but is never shown.** About 200 route files append `breadcrumbs` to
  the route context; the renderer is unused.
- **Inherited UI.** All of it is v3 Sidebar, Command, Popover and DropdownMenu (Radix), plus
  framer-motion and FontAwesome.

Defects found on the way, to fix rather than carry over:

1. "Sub Organizations" calls an upgrade popup that is never rendered, so the click does nothing.
2. "Copy Token" in the user menu copies the live session token to the clipboard.
3. Some pages have no way in: the IP allowlist (`SM/allowlist`), certificate templates, and the
   certificate manager's app connections.
4. Several files are exported but never used: `AdminNavBar`, `SidebarHeader`, `MenuIconButton`,
   the approvals submenu and two certificate submenus.

## 2. Information architecture

The rail shows where you are without drilling down. Sub-sections become **Tabs inside the page**
(the settings pages already switch on `selectedTab`), so the rail never replaces itself with a
submenu.

| Rail group | Items | Shown when |
| --- | --- | --- |
| *(top)* | Vaultix home; menu toggle | always |
| **Products** | Secrets, Certificates, Key management, Privileged access, Secret scanning | always; each opens its project list or, for certificates and PAM, their own home as today |
| **This project** | the current product's items, e.g. for Secrets: Secrets, Approvals (count), Integrations, Insights, Access, Audit log, Settings | inside a project; same permission conditions as today |
| **Organization** | Integrations, Access control, Audit log, Settings | always; settings items obey `isSubOrganization` as today |
| **Assist** | Clyffy | not on the server console |
| *(bottom)* | Notifications (count), Help, account menu; Server console for super admins | always |

The server console (`/admin`) uses the same frame with its own groups: General, Resources, Early
access, Access, Encryption, Authentication, Integrations, AI, MCPL, Caching, Environment.

Every condition in the inventory is kept exactly: certificate admin-only groups, PAM capabilities,
the secret scanning entitlement and permission before the findings count is fetched, the legacy
certificate group, and sub-organization rules. They move into one **navigation model** (data, not
JSX) that is unit tested against those conditions.

## 3. The pieces

- **Header: breadcrumbs that switch.** Organization › Product › Project › Page, rendered from the
  route context that already carries breadcrumbs. The organization and project segments are
  switchers: a Combobox in a Popover, searchable, with favourites first. They keep today's
  sub-organization token swap, SSO hand-off and MFA, and the "New project" permission and limit.
- **Command palette (Ctrl/Cmd-K).** A Dialog holding a Combobox-style list that searches pages
  (from the navigation model), projects, catalog actions (the same actions MCP exposes, so models
  and people share one list) and "Ask Clyffy". Actions run through their existing handlers;
  nothing in it reads or shows a secret value.
- **Clyffy's overlay.** A non-modal panel docked at the inline end, opened from the rail, the
  palette or Ctrl/Cmd-J. The page stays usable beside it. Panes: chat, persona picker, actions
  taken (the signal-fabric receipts), memories, and "Try it" from 0126. It reuses the assistant
  logic in `components/vaultix/` but draws with design-system primitives.
- **Notifications.** A Popover from the rail: the inbox (`useGetMyNotifications`, mark read,
  delete), What's New and the update notice.
- **Account menu.** A MenuButton: Personal settings, Invite users (permission as today), Help and
  documentation, Log out.
- **Banners.** A new Banner primitive with a single banner region above the content, for the
  Redis, SMTP, audit-log, insecure-connection, network-health, sign-up-disabled and
  assumed-privilege banners.

New design-system parts this needs: **Banner**, **Badge** (counts), **Breadcrumbs**, and the
**command palette** composite. Each comes with a story, keyboard spec and axe test, as in phase 1.

## 4. Order of work

Each step builds through the canonical image and can ship on its own.

1. **Navigation model and app shell.** `src/shell/` (product code, not design system) holds the
   navigation model, with unit tests for every condition, and `AppShell`, which feeds the model
   to `AppFrame` with TanStack Router links.
2. **Swap the org layout.** The `org-layout` route renders `AppShell`; the banners move into the
   banner region. Settings sub-sections show as in-page Tabs.
3. **Server console** on the same shell.
4. **Breadcrumbs and switchers** in the header.
5. **Command palette.**
6. **Clyffy's overlay**, replacing the Sheet launcher.
7. **Notifications and the account menu.**
8. **Delete the old shell:**
   - `OrganizationLayout`, `AdminLayout` and the `ProjectLayout` pickers;
   - the v3 Sidebar and the unused files;
   - lower the Radix ceiling in the design-system check.

## 5. Done when

- The frame, palette and overlay pass their Storybook tests.
- On the image, a keyboard-only walkthrough passes at 390, 1100 and 1440 px: sign in, switch
  organization and project, reach every rail item, use the palette, open Clyffy, read
  notifications, sign out. A screen-reader smoke pass covers the same path.
- Every permission condition from the inventory has a unit test in the navigation model.
- The preview runs on it, and the old shell files are gone.

## 6. Decisions for the owner

1. **The information architecture in section 2:** products always in the rail, the current
   project's items as their own group, and sub-sections as in-page tabs instead of sidebar
   submenus.
2. **"Copy Token":** remove it. Recommended: people and tools sign in with `vaultix login` or
   `vaultix mcp` instead of handling a session token.
3. **Clyffy's overlay:** docked beside the page (recommended) or floating over it; and the
   shortcut (Ctrl/Cmd-J proposed).
4. **The wordmark asset:** replace `public/images/vaultix-wordmark.svg` (teal) with the
   `branding/` lockup.
