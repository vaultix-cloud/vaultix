// Does the router the frontend actually runs (@tanstack/react-router 1.95.1) give the same answer for an ArkType
// validator as for the zodValidator it uses today, on schemas taken from the real route files? Each schema is the
// repository's own, ported by the rules in docs/0137, and both versions are mounted on the same real router and
// given the same URLs. The router, its search-string parser and its error handling are the real ones.
import assert from "node:assert/strict";
import test from "node:test";
import { type } from "arktype";
import { createMemoryHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";
import { catchKey, coerceString, coerceStringOptional, fallbackTo, shape } from "./helpers.mjs";

// Stand-ins for the repository's TypeScript enums (their runtime form).
const Tabs = Object.freeze({ SecretSyncs: "secret-syncs", AppConnections: "app-connections", Legacy: "legacy" });
const PamTab = Object.freeze({ Overview: "overview", Sessions: "sessions" });

// [name, the repository's Zod schema, its ArkType port]
const schemas = [
  ["AccessControlPageQuerySchema (pages/organization/AccessManagementPage)",
    z.object({ selectedTab: z.string().catch("member"), action: z.string().catch("") }),
    shape({ selectedTab: catchKey(type("string"), "member"), action: catchKey(type("string"), "") })],
  ["settingsPageSearchSchema (pages/cert-manager/SettingsPage)",
    z.object({ selectedTab: z.string().optional().default("app-connections") }),
    shape({ selectedTab: "string = 'app-connections'" })],
  ["SettingsPageQueryParams (pages/organization/SettingsPage)",
    z.object({ selectedTab: z.string().catch("") }),
    shape({ selectedTab: catchKey(type("string"), "") })],
  ["IntegrationsListPageQuerySchema (pages/cert-manager/IntegrationsListPage): optional enums, no catch",
    z.object({ selectedTab: z.nativeEnum(Tabs).optional(), connectionId: z.string().optional(), legacy: z.enum(["true"]).optional() }),
    shape({ "selectedTab?": type.valueOf(Tabs), "connectionId?": "string | undefined", "legacy?": "'true'" })],
  ["pamSheetSearchParams (hooks/usePamSheetState): optional + catch(undefined)",
    z.object({ accountId: z.string().optional().catch(undefined), folderId: z.string().optional().catch(undefined), tab: z.nativeEnum(PamTab).optional().catch(undefined) }),
    shape({ "accountId?": fallbackTo(type("string | undefined"), undefined), "folderId?": fallbackTo(type("string | undefined"), undefined), "tab?": fallbackTo(type.valueOf(PamTab).or("undefined"), undefined) })],
  ["GithubOAuthCallbackPageQueryParamsSchema (secret-manager/.../GithubOauthCallbackPage): coerce + catch",
    z.object({ state: z.string().catch(""), installation_id: z.coerce.string().optional().catch(""), code: z.coerce.string().catch("") }),
    // Faithful, not corrected: Zod coerces a MISSING key first (String(undefined) is "undefined"), so .catch("") never runs for it.
    shape({ state: catchKey(type("string"), ""), "installation_id?": fallbackTo(coerceStringOptional, ""), code: [fallbackTo(coerceString, ""), "=", "undefined"] })],
  ["a required key with no catch (an OAuth callback that must carry a code)",
    z.object({ code: z.string(), state: z.string().optional() }),
    shape({ code: "string", "state?": "string | undefined" })]
];

// Real URLs and the awkward ones the router's own parser turns into numbers, booleans, null, arrays and objects.
const urls = [
  "", "?selectedTab=members", "?selectedTab=", "?selectedTab=123", "?selectedTab=true", "?selectedTab=null", "?selectedTab=%22quoted%22", "?selectedTab=a&selectedTab=b",
  "?selectedTab=%7B%22a%22%3A1%7D", "?selectedTab=%5B1%2C2%5D", "?selectedTab=app-connections", "?selectedTab=secret-syncs", "?selectedTab=bogus", "?selectedTab=%F0%9F%98%80",
  "?action=create", "?action=", "?action=0", "?action=false", "?selectedTab=members&action=create&extra=1",
  "?accountId=abc", "?accountId=123", "?accountId=", "?accountId=null", "?folderId=f1&tab=overview", "?tab=bogus", "?tab=sessions&accountId=a1", "?tab=1",
  "?legacy=true", "?legacy=false", "?legacy=%22true%22", "?connectionId=c1&selectedTab=legacy",
  "?state=s1&code=c1", "?state=s1&code=123", "?code=", "?code=%22x%22", "?state=s1&code=c1&installation_id=42", "?installation_id=", "?installation_id=abc&code=c1", "?code=true&state=1", "?code=null"
];

/** Mount one validator on the real router, load a URL, and report what the router ended up with. */
async function outcome(validateSearch, url) {
  const root = createRootRoute();
  const page = createRoute({ getParentRoute: () => root, path: "/page", validateSearch });
  const router = createRouter({ routeTree: root.addChildren([page]), history: createMemoryHistory({ initialEntries: [`/page${url}`] }) });
  try { await router.load(); } catch (error) { return { status: "load-threw", message: String(error?.message).slice(0, 80) }; }
  const match = router.state.matches.find(m => m.routeId === page.id);
  if (!match) return { status: "no-match" };
  const failed = match.status === "error" || match.searchError || match.error;
  if (failed) return { status: "error" };
  return { status: "ok", search: normalise(match.search) };
}
const normalise = value => JSON.stringify(value, (key, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v));

const rows = [];
for (const [name, zodSchema, arkSchema] of schemas) {
  test(`${name}: the real router gives the same answer for zodValidator and for ArkType on ${urls.length} URLs`, async () => {
    const differences = [];
    let ok = 0; let failed = 0;
    for (const url of urls) {
      const viaZod = await outcome(zodValidator(zodSchema), url);
      const viaArk = await outcome(arkSchema, url);
      if (viaZod.status === "ok") ok += 1; else failed += 1;
      if (viaZod.status !== viaArk.status || viaZod.search !== viaArk.search) differences.push({ url, zod: viaZod, arktype: viaArk });
    }
    rows.push({ name, ok, failed, differences: differences.length });
    assert.deepEqual(differences.slice(0, 4), [], `${differences.length} of ${urls.length} URLs were handled differently`);
    assert.ok(ok > 0, "some URLs must validate, or this compares nothing");
  });
}

test("the ArkType validators are accepted by the router as Standard Schema (no adapter), with types", () => {
  const v = schemas[0][2];
  assert.equal(typeof v["~standard"].validate, "function");
  assert.equal(v["~standard"].version, 1);
  assert.equal(v["~standard"].vendor, "arktype");
});

test("a latent quirk, kept on purpose: with z.coerce.string().catch(''), a URL without the key gives the string \"undefined\", not ''", async () => {
  const [, zodSchema, arkSchema] = schemas[5];
  const viaZod = await outcome(zodValidator(zodSchema), "?state=s1");
  const viaArk = await outcome(arkSchema, "?state=s1");
  assert.deepEqual(JSON.parse(viaZod.search), { state: "s1", code: "undefined" }, "today's app: code is the text 'undefined', which is truthy");
  assert.equal(viaArk.search, viaZod.search, "the faithful port keeps it; fixing it is a decision, not a side effect of converting");
});

test("a validation that fails is an error to the router in both worlds, not a crash", async () => {
  const [, zodSchema, arkSchema] = schemas[6];
  assert.equal((await outcome(zodValidator(zodSchema), "")).status, "error");
  assert.equal((await outcome(arkSchema, "")).status, "error");
});

test.after(() => { for (const row of rows) console.log(`# ${row.name.slice(0, 70)}: ${row.ok} URLs validate, ${row.failed} are refused, ${row.differences} differences`); });
