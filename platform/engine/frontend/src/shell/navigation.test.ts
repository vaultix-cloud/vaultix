import { describe, expect, it } from "vitest";

import { ProjectType } from "@app/hooks/api/projects/types";

import { buildNavigation, TNavInput } from "./navigation";

const ORG = "/organizations/org1";

const base = (overrides: Partial<TNavInput> = {}): TNavInput => ({
  pathname: `${ORG}/projects`,
  orgId: "org1",
  project: null,
  certManager: {
    activeProjectId: null,
    isAdmin: false,
    legacy: { alerts: false, policies: false, syncs: false }
  },
  pam: {
    isProductAdmin: false,
    canViewSessions: false,
    isApprover: false,
    canViewAuditLogs: false
  },
  counts: {},
  ...overrides
});

const ids = (input: TNavInput) =>
  Object.fromEntries(buildNavigation(input).groups.map((g) => [g.id, g.items.map((i) => i.id)]));

describe("organization scope", () => {
  it("shows products and organization, no project group", () => {
    const nav = buildNavigation(base());
    expect(nav.scope).toBe("org");
    expect(nav.groups.map((g) => g.id)).toEqual(["products", "organization"]);
    expect(nav.currentId).toBe("org-home");
  });

  it("marks one current item: the longest matching prefix", () => {
    const nav = buildNavigation(base({ pathname: `${ORG}/sso` }));
    expect(nav.currentId).toBe("org-settings");
    expect(buildNavigation(base({ pathname: `${ORG}/roles/admin` })).currentId).toBe("org-access");
  });

  it("links certificates to the active certificate project when there is one", () => {
    const withActive = buildNavigation(
      base({ certManager: { ...base().certManager, activeProjectId: "cm1" } })
    );
    const cert = withActive.groups[0].items.find((i) => i.id === "certificates");
    expect(cert?.href).toBe(`${ORG}/projects/cert-manager/cm1/overview`);
  });
});

describe("secret manager project", () => {
  const sm = base({
    project: { id: "p1", type: ProjectType.SecretManager },
    pathname: `${ORG}/projects/secret-management/p1/secrets/dev`,
    counts: { secretApprovals: 3 }
  });

  it("lists the project items and carries the approvals count", () => {
    const nav = buildNavigation(sm);
    const project = nav.groups.find((g) => g.id === "project");
    expect(project?.items.map((i) => i.id)).toEqual([
      "sm-secrets",
      "sm-approvals",
      "sm-integrations",
      "sm-insights",
      "sm-access",
      "sm-audit",
      "sm-settings"
    ]);
    expect(project?.items.find((i) => i.id === "sm-approvals")?.count).toBe(3);
  });

  it("makes the project item current, not the product it belongs to", () => {
    expect(buildNavigation(sm).currentId).toBe("sm-secrets");
  });

  it("gives the IP allowlist a way in through settings", () => {
    expect(
      buildNavigation({ ...sm, pathname: `${ORG}/projects/secret-management/p1/allowlist` })
        .currentId
    ).toBe("sm-settings");
  });
});

describe("certificate project", () => {
  const cm = (isAdmin: boolean, activeProjectId: string | null, legacy = false) =>
    base({
      project: { id: "cm1", type: ProjectType.CertificateManager },
      pathname: `${ORG}/projects/cert-manager/cm1/requests`,
      certManager: {
        activeProjectId,
        isAdmin,
        legacy: { alerts: legacy, policies: legacy, syncs: legacy }
      }
    });

  it("shows members only requests, applications and code signing", () => {
    expect(ids(cm(false, "cm1")).project).toEqual(["cm-requests", "cm-applications", "cm-signers"]);
  });

  it("hides applications in a legacy project", () => {
    expect(ids(cm(false, "other")).project).toEqual(["cm-requests", "cm-signers"]);
  });

  it("shows admins everything, and legacy entries only when legacy data exists", () => {
    const admin = ids(cm(true, "cm1")).project;
    expect(admin).toContain("cm-dashboard");
    expect(admin).toContain("cm-authorities");
    expect(admin).toContain("cm-settings");
    expect(admin).not.toContain("cm-alerts");
    expect(ids(cm(true, "cm1", true)).project).toEqual(
      expect.arrayContaining(["cm-alerts", "cm-approvals", "cm-syncs"])
    );
  });
});

describe("privileged access", () => {
  const pam = (caps: Partial<TNavInput["pam"]>) =>
    base({
      pathname: `${ORG}/pam/accounts`,
      pam: { ...base().pam, ...caps },
      counts: { pamApprovals: 2 }
    });

  it("shows accounts to everyone and nothing more without capabilities", () => {
    expect(ids(pam({})).project).toEqual(["pam-accounts"]);
  });

  it("adds each item with its capability", () => {
    expect(ids(pam({ canViewSessions: true })).project).toEqual(["pam-accounts", "pam-sessions"]);
    expect(ids(pam({ isApprover: true })).project).toEqual(["pam-accounts", "pam-approvals"]);
    expect(ids(pam({ canViewAuditLogs: true })).project).toEqual(["pam-accounts", "pam-audit"]);
    expect(ids(pam({ isProductAdmin: true })).project).toEqual([
      "pam-accounts",
      "pam-templates",
      "pam-discovery",
      "pam-access"
    ]);
  });

  it("carries the pending approvals count", () => {
    const nav = buildNavigation(pam({ isApprover: true }));
    const approvals = nav.groups.flatMap((g) => g.items).find((i) => i.id === "pam-approvals");
    expect(approvals?.count).toBe(2);
    expect(nav.currentId).toBe("pam-accounts");
  });
});

describe("other products", () => {
  it("builds KMS and secret scanning projects", () => {
    expect(
      ids(
        base({
          project: { id: "k1", type: ProjectType.KMS },
          pathname: `${ORG}/projects/kms/k1/kmip`
        })
      ).project
    ).toEqual(["kms-overview", "kms-kmip", "kms-access", "kms-audit", "kms-settings"]);
    const ss = buildNavigation(
      base({
        project: { id: "s1", type: ProjectType.SecretScanning },
        pathname: `${ORG}/projects/secret-scanning/s1/findings`,
        counts: { scanningFindings: 7 }
      })
    );
    expect(ss.currentId).toBe("ss-findings");
    expect(ss.groups.flatMap((g) => g.items).find((i) => i.id === "ss-findings")?.count).toBe(7);
  });
});

describe("server console", () => {
  it("switches to the console groups on /admin paths", () => {
    const nav = buildNavigation(base({ pathname: "/admin/encryption" }));
    expect(nav.scope).toBe("admin");
    expect(nav.groups.map((g) => g.id)).toEqual(["console"]);
    expect(nav.currentId).toBe("admin-encryption");
    expect(buildNavigation(base({ pathname: "/admin" })).currentId).toBe("admin-general");
  });
});
