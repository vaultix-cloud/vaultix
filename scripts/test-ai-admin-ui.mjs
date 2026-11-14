// Admin > AI in a real browser against the packaged image (docs/0126): the five tabs render, the
// connection chooser offers every kind, the Hugging Face flow links to a token with the right
// permission, a Custom connection is refused at its field and then saved and tested, and a
// persona form refuses an out-of-schema value beside its field. Called by test-image-app.mjs.
import assert from "node:assert/strict";
import { resolve } from "node:path";

export async function testAiAdminUi({ page, expect, origin, evidence, expectedFailures = new Set() }) {
  await page.goto(`${origin}/admin/ai-assistant`);
  // A fresh instance shows its first-run screen once before any admin page.
  const openWorkspace = page.getByRole("button", { name: "Open Workspace" });
  await expect(openWorkspace.or(page.getByRole("heading", { name: "AI Assistant" }))).toBeVisible({ timeout: 30000 });
  if (await openWorkspace.isVisible()) {
    await openWorkspace.click();
    await page.waitForURL(url => !url.pathname.startsWith("/admin/setup"));
    await page.goto(`${origin}/admin/ai-assistant`);
  }
  await expect(page.getByRole("heading", { name: "AI Assistant" })).toBeVisible({ timeout: 30000 });
  const tabs = page.getByRole("tablist", { name: "AI settings" });
  for (const name of ["Connections", "Personas", "Routing", "Memories", "Try it"]) {
    await expect(tabs.getByRole("tab", { name })).toBeVisible();
  }
  await page.screenshot({ path: resolve(evidence, "ai-connections-empty.png"), fullPage: true });

  await page.getByRole("button", { name: "Add Connection" }).click();
  for (const kind of ["Anthropic", "OpenAI", "Amazon Bedrock", "Google Vertex", "Hugging Face", "Custom"]) {
    await expect(page.getByRole("button", { name: new RegExp(`^${kind}`) }).first()).toBeVisible();
  }
  await page.screenshot({ path: resolve(evidence, "ai-connection-chooser.png"), fullPage: true });
  await page.getByRole("button", { name: /^Hugging Face/ }).first().click();
  const tokenLink = page.getByRole("link", { name: /token/i }).first();
  await expect(tokenLink).toBeVisible();
  const href = await tokenLink.getAttribute("href");
  assert.ok(href?.includes("ownUserPermissions=inference.serverless.write") && href.includes("tokenType=fineGrained"),
    "the Hugging Face token link must preselect the Inference Providers permission");
  await expect(page.getByLabel("Hugging Face token")).toHaveAttribute("type", "password");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: resolve(evidence, "ai-huggingface-step1.png") });
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Add Connection" }).click();
  await page.getByRole("button", { name: /^Custom/ }).first().click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Name", { exact: true }).fill("Stand-in gateway");
  await sheet.getByLabel("Endpoint URL").fill("http://llm.example.test/v1");
  await sheet.getByLabel("Standard model").fill("stand-in-1");
  await sheet.getByLabel("API key").fill("placeholder-key-for-ui-proof");
  await page.waitForTimeout(500);
  await page.screenshot({ path: resolve(evidence, "ai-custom-form.png") });
  // The server's refusal of a key over plain http is the point of this step.
  expectedFailures.add("/api/vx/v1/ai/connections");
  await sheet.getByRole("button", { name: "Add Connection" }).click();
  const endpointInput = sheet.getByLabel("Endpoint URL");
  await expect(endpointInput).toHaveAttribute("aria-invalid", "true", { timeout: 15000 });
  await expect(sheet.getByText(/only sent over https/i)).toBeVisible();
  await page.screenshot({ path: resolve(evidence, "ai-custom-refused.png") });
  await sheet.getByLabel("How the key is sent").click();
  await page.getByRole("option", { name: "No key" }).click();
  expectedFailures.delete("/api/vx/v1/ai/connections");
  await sheet.getByRole("button", { name: "Add Connection" }).click();
  await expect(sheet.getByRole("button", { name: "Test Now" })).toBeVisible({ timeout: 15000 });
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("Stand-in gateway", { exact: true })).toBeVisible();
  await expect(page.getByText("In Use", { exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(evidence, "ai-connections-saved.png"), fullPage: true });

  const tabs2 = page.getByRole("tablist", { name: "AI settings" });
  await tabs2.getByRole("tab", { name: "Personas" }).click();
  await expect(page.getByRole("row", { name: /Secrets specialist/ })).toBeVisible();
  await page.screenshot({ path: resolve(evidence, "ai-personas.png"), fullPage: true });
  await page.getByRole("row", { name: /Secrets specialist/ }).getByRole("button", { name: "Edit" }).click();
  const personaSheet = page.getByRole("dialog");
  const temperature = personaSheet.getByLabel("Temperature");
  await temperature.fill("3");
  await temperature.blur();
  await expect(temperature).toHaveAttribute("aria-invalid", "true");
  await page.waitForTimeout(500);
  await page.screenshot({ path: resolve(evidence, "ai-persona-refused.png") });
  await page.keyboard.press("Escape");
  for (const [tab, file] of [["Routing", "ai-routing.png"], ["Try it", "ai-try-it.png"]]) {
    await tabs2.getByRole("tab", { name: tab }).click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: resolve(evidence, file), fullPage: true });
  }
  // Leave the instance as it was found: later proofs expect the assistant to be off.
  await tabs2.getByRole("tab", { name: "Connections" }).click();
  await page.getByRole("row", { name: /Stand-in gateway/ }).getByRole("button", { name: "Remove" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: /Remove/ }).click();
  await expect(page.getByText("No connections yet")).toBeVisible({ timeout: 15000 });
}
