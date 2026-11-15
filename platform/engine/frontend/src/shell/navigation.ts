// The Vaultix navigation model (docs/0131 section 2): every rail entry, the rule that shows it and
// the count it carries, as data. It is pure so each permission rule carried over from the inherited
// shell is unit tested; AppShell gathers the inputs from the app's contexts and draws the result.
import type { TIconName } from "@app/design-system";
import { ProjectType } from "@app/hooks/api/projects/types";

export type TNavItem = {
  id: string;
  label: string;
  href: string;
  icon: TIconName;
  count?: number;
  // Path prefixes that make this the current page; the longest match across the rail wins.
  match?: string[];
};

export type TNavGroup = { id: string; label: string; items: TNavItem[] };

export type TNavInput = {
  pathname: string;
  orgId: string;
  project: { id: string; type: ProjectType } | null;
  certManager: {
    // The organization's active certificate project, if one is set up.
    activeProjectId: string | null;
    // hasProjectRole("admin") in the current certificate project.
    isAdmin: boolean;
    legacy: { alerts: boolean; policies: boolean; syncs: boolean };
  };
  pam: {
    isProductAdmin: boolean;
    canViewSessions: boolean;
    isApprover: boolean;
    canViewAuditLogs: boolean;
  };
  counts: {
    secretApprovals?: number;
    certApprovals?: number;
    // Only fetched when the entitlement and the read permission allow it.
    scanningFindings?: number;
    pamApprovals?: number;
  };
};

export type TNavigation = { groups: TNavGroup[]; currentId: string | null; scope: "org" | "admin" };

const item = (
  id: string,
  label: string,
  href: string,
  icon: TIconName,
  extra: Partial<TNavItem> = {}
): TNavItem => ({ id, label, href, icon, ...extra });

const projectBase = (org: string, type: ProjectType, projectId: string) =>
  type === ProjectType.PAM
    ? `${org}/pam`
    : `${org}/projects/${type === ProjectType.SecretManager ? "secret-management" : type}/${projectId}`;

const products = (input: TNavInput, org: string): TNavGroup => {
  const cert = input.certManager.activeProjectId
    ? `${org}/projects/cert-manager/${input.certManager.activeProjectId}/overview`
    : `${org}/projects/cert-manager`;
  return {
    id: "products",
    label: "Products",
    items: [
      item("secrets", "Secrets", `${org}/projects/secret-management`, "lock"),
      item("certificates", "Certificates", cert, "shield", {
        match: [`${org}/projects/cert-manager`]
      }),
      item("kms", "Key management", `${org}/projects/kms`, "key"),
      item("pam", "Privileged access", `${org}/pam/access`, "terminal", { match: [`${org}/pam`] }),
      item("scanning", "Secret scanning", `${org}/projects/secret-scanning`, "search")
    ]
  };
};

const secretManagerItems = (base: string, input: TNavInput): TNavItem[] => [
  item("sm-secrets", "Secrets", `${base}/overview`, "lock", {
    match: [`${base}/overview`, `${base}/secrets`, `${base}/commits`]
  }),
  item("sm-approvals", "Approvals", `${base}/approval`, "check", {
    count: input.counts.secretApprovals
  }),
  item("sm-integrations", "Integrations", `${base}/integrations`, "link", {
    match: [`${base}/integrations`, `${base}/app-connections`]
  }),
  item("sm-insights", "Insights", `${base}/insights`, "clock"),
  item("sm-access", "Access", `${base}/access-management`, "users"),
  item("sm-audit", "Audit log", `${base}/audit-logs`, "file"),
  item("sm-settings", "Settings", `${base}/settings`, "edit", {
    match: [`${base}/settings`, `${base}/allowlist`]
  })
];

const certManagerItems = (base: string, input: TNavInput): TNavItem[] => {
  const { isAdmin, legacy } = input.certManager;
  const isLegacyProject =
    input.project !== null && input.certManager.activeProjectId !== input.project.id;
  const list: TNavItem[] = [];
  if (isAdmin) {
    list.push(
      item("cm-dashboard", "Dashboard", `${base}/overview`, "home"),
      item("cm-inventory", "Inventory", `${base}/inventory`, "file"),
      item("cm-discovery", "Discovery", `${base}/discovery`, "search")
    );
  }
  list.push(
    item("cm-requests", "Approval requests", `${base}/requests`, "check", {
      count: input.counts.certApprovals
    })
  );
  if (!isLegacyProject)
    list.push(item("cm-applications", "Applications", `${base}/applications`, "layers"));
  list.push(item("cm-signers", "Code signing", `${base}/code-signing`, "edit"));
  if (isAdmin) {
    list.push(
      item(
        "cm-authorities",
        "Certificate authorities",
        `${base}/certificate-authorities`,
        "shield"
      ),
      item("cm-policies", "Certificate policies", `${base}/certificate-policies`, "file", {
        match: [`${base}/certificate-policies`, `${base}/policies`]
      }),
      item("cm-profiles", "Certificate profiles", `${base}/certificate-profiles`, "file", {
        match: [`${base}/certificate-profiles`, `${base}/certificate-templates`]
      })
    );
    if (legacy.alerts) list.push(item("cm-alerts", "Alerts (legacy)", `${base}/alerting`, "bell"));
    if (legacy.policies)
      list.push(item("cm-approvals", "Approval policies (legacy)", `${base}/approvals`, "shield"));
    if (legacy.syncs)
      list.push(item("cm-syncs", "Certificate syncs (legacy)", `${base}/integrations`, "refresh"));
    list.push(
      item("cm-access", "Access", `${base}/access-management`, "users"),
      item("cm-audit", "Audit log", `${base}/audit-logs`, "file"),
      item("cm-settings", "Settings", `${base}/settings`, "edit", {
        match: [`${base}/settings`, `${base}/app-connections`]
      })
    );
  }
  return list;
};

const kmsItems = (base: string): TNavItem[] => [
  item("kms-overview", "Overview", `${base}/overview`, "home"),
  item("kms-kmip", "KMIP", `${base}/kmip`, "key"),
  item("kms-access", "Access", `${base}/access-management`, "users"),
  item("kms-audit", "Audit log", `${base}/audit-logs`, "file"),
  item("kms-settings", "Settings", `${base}/settings`, "edit")
];

const scanningItems = (base: string, input: TNavInput): TNavItem[] => [
  item("ss-sources", "Data sources", `${base}/data-sources`, "database"),
  item("ss-findings", "Findings", `${base}/findings`, "search", {
    count: input.counts.scanningFindings
  }),
  item("ss-connections", "App connections", `${base}/app-connections`, "link"),
  item("ss-access", "Access", `${base}/access-management`, "users"),
  item("ss-audit", "Audit log", `${base}/audit-logs`, "file"),
  item("ss-settings", "Settings", `${base}/settings`, "edit")
];

const pamItems = (base: string, input: TNavInput): TNavItem[] => {
  const { isProductAdmin, canViewSessions, isApprover, canViewAuditLogs } = input.pam;
  return [
    item("pam-accounts", "Accounts", `${base}/accounts`, "folder"),
    ...(isProductAdmin
      ? [
          item("pam-templates", "Account templates", `${base}/templates`, "file"),
          item("pam-discovery", "Discovery", `${base}/discovery`, "search")
        ]
      : []),
    ...(canViewSessions ? [item("pam-sessions", "Sessions", `${base}/sessions`, "terminal")] : []),
    ...(isApprover
      ? [
          item("pam-approvals", "Approval requests", `${base}/approval-requests`, "check", {
            count: input.counts.pamApprovals
          })
        ]
      : []),
    ...(canViewAuditLogs ? [item("pam-audit", "Audit log", `${base}/audit-logs`, "file")] : []),
    ...(isProductAdmin ? [item("pam-access", "Access", `${base}/access-management`, "users")] : [])
  ];
};

const PRODUCT_NAME: Record<ProjectType, string> = {
  [ProjectType.SecretManager]: "This project",
  [ProjectType.CertificateManager]: "Certificates",
  [ProjectType.KMS]: "This project",
  [ProjectType.SecretScanning]: "This project",
  [ProjectType.PAM]: "Privileged access"
};

const projectGroup = (input: TNavInput, org: string): TNavGroup | null => {
  const onPam = input.pathname.startsWith(`${org}/pam/`) || input.pathname === `${org}/pam`;
  const project = input.project ?? (onPam ? { id: "", type: ProjectType.PAM } : null);
  if (!project) return null;
  const base = projectBase(org, project.type, project.id);
  const builders: Record<ProjectType, () => TNavItem[]> = {
    [ProjectType.SecretManager]: () => secretManagerItems(base, input),
    [ProjectType.CertificateManager]: () => certManagerItems(base, input),
    [ProjectType.KMS]: () => kmsItems(base),
    [ProjectType.SecretScanning]: () => scanningItems(base, input),
    [ProjectType.PAM]: () => pamItems(base, input)
  };
  return { id: "project", label: PRODUCT_NAME[project.type], items: builders[project.type]() };
};

const organizationGroup = (org: string): TNavGroup => ({
  id: "organization",
  label: "Organization",
  items: [
    item("org-home", "All projects", `${org}/projects`, "home", { match: [`${org}/projects`] }),
    item("org-integrations", "Integrations", `${org}/integrations`, "link", {
      match: [`${org}/integrations`, `${org}/app-connections`]
    }),
    item("org-access", "Access control", `${org}/access-management`, "users", {
      match: [
        `${org}/access-management`,
        `${org}/members`,
        `${org}/identities`,
        `${org}/groups`,
        `${org}/roles`
      ]
    }),
    item("org-audit", "Audit log", `${org}/audit-logs`, "file"),
    item("org-settings", "Settings", `${org}/settings`, "edit", {
      match: [`${org}/settings`, `${org}/sso`, `${org}/networking`, `${org}/oauth-applications`]
    })
  ]
});

const adminGroups = (): TNavGroup[] => [
  {
    id: "console",
    label: "Server console",
    items: [
      item("admin-general", "General", "/admin", "home"),
      item("admin-resources", "Resources", "/admin/resources/overview", "layers"),
      item("admin-early-access", "Early access", "/admin/early-access", "user"),
      item("admin-access", "Access", "/admin/access-management", "users"),
      item("admin-encryption", "Encryption", "/admin/encryption", "lock"),
      item("admin-authentication", "Authentication", "/admin/authentication", "shield"),
      item("admin-integrations", "Integrations", "/admin/integrations", "link"),
      item("admin-ai", "AI", "/admin/ai-assistant", "bot"),
      item("admin-mcpl", "MCPL workbench", "/admin/mcpl", "terminal"),
      item("admin-caching", "Caching", "/admin/caching", "database"),
      item("admin-environment", "Environment", "/admin/environment", "key")
    ]
  }
];

const longestMatch = (groups: TNavGroup[], pathname: string): string | null => {
  let best: { id: string; length: number } | null = null;
  groups.forEach((group) =>
    group.items.forEach((entry) => {
      (entry.match ?? [entry.href]).forEach((prefix) => {
        const hit = pathname === prefix || pathname.startsWith(`${prefix}/`);
        if (hit && (!best || prefix.length > best.length))
          best = { id: entry.id, length: prefix.length };
      });
    })
  );
  return best ? (best as { id: string }).id : null;
};

export const buildNavigation = (input: TNavInput): TNavigation => {
  const onServerConsole = input.pathname === "/admin" || input.pathname.startsWith("/admin/");
  if (onServerConsole) {
    const groups = adminGroups();
    return { groups, currentId: longestMatch(groups, input.pathname), scope: "admin" };
  }
  const org = `/organizations/${input.orgId}`;
  const project = projectGroup(input, org);
  const groups = [
    products(input, org),
    ...(project ? [project] : []),
    organizationGroup(org)
  ].filter((group) => group.items.length > 0);
  return { groups, currentId: longestMatch(groups, input.pathname), scope: "org" };
};
