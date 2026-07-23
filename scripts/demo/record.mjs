// Records a silent walkthrough of CC-RAGOS to a .webm using Playwright.
// Auth creds come from the environment (source .env first) — nothing is hardcoded,
// and the password is typed into a masked field so it never appears on screen.
//
// Usage:  set -a; source ../../.env; set +a; WORKSPACE=ccragos_chunks node record.mjs
import { chromium } from "playwright";

const BASE = process.env.DEMO_BASE ?? "http://localhost:3000";
const WORKSPACE = process.env.WORKSPACE ?? "ccragos_chunks";
const USER = process.env.AUTH_ADMIN_USER ?? "admin";
const PASS = process.env.AUTH_ADMIN_PASSWORD ?? "admin";
const OUT = process.env.OUT_DIR ?? "out";
const W = 1440, H = 900;

// Gentle wrapper so one missing section never aborts the whole recording.
async function step(name, fn) {
  try { await fn(); } catch (e) { console.warn(`· skipped "${name}": ${e.message}`); }
}

const run = async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    recordVideo: { dir: OUT, size: { width: W, height: H } },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const pause = (ms = 1400) => page.waitForTimeout(ms);

  // 1) Login
  await step("open + login", async () => {
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.waitForURL(/\/login/, { timeout: 8000 }).catch(() => {});
    if (page.url().includes("/login")) {
      await page.fill('input[placeholder="username"]', USER);
      await page.fill('input[type="password"]', PASS);
      await pause(700);
      await page.click('button[type="submit"]');
      await page.waitForURL((u) => !u.toString().includes("/login"), { timeout: 15000 });
    }
    await pause(1500);
  });

  // 1b) Make sure the demo workspace is active
  await step("select workspace", async () => {
    await page.selectOption('select[aria-label="Active workspace"]', { value: WORKSPACE }).catch(() => {});
    await pause(1200);
  });

  // 2) Ask a question — show the streamed, cited answer + pipeline chips
  await step("ask a question", async () => {
    const q = "How does document ingestion work here, and how are multi-type documents handled? Give the full flow.";
    const box = page.locator('textarea[placeholder*="Ask"]');
    await box.click();
    await box.pressSequentially(q, { delay: 14 });
    await pause(600);
    await page.keyboard.press("Enter");
    // Wait for the answer to FINISH: the "helpful?" feedback row only renders once
    // streaming stops (content present && not busy).
    await page.waitForSelector("text=helpful?", { timeout: 60000 }).catch(() => {});
    await pause(2200);
    // scroll slowly through the cited answer
    for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 340); await pause(1400); }
    await pause(1500);
  });

  // 3) Studio — Inspect tools
  await step("studio inspect", async () => {
    await page.click("text=Inspect").catch(() => {});
    await pause(2200);
  });

  // 4) Knowledge Graph
  await step("knowledge graph", async () => {
    await page.goto(`${BASE}/graph`, { waitUntil: "networkidle" });
    await page.click("text=Load").catch(() => {});
    await pause(4500);
  });

  // 5) Embedding Explorer (meaning map)
  await step("embeddings", async () => {
    await page.goto(`${BASE}/embeddings`, { waitUntil: "networkidle" });
    await pause(4000);
  });

  // 6) Study Library → open a saved mind map (big fit-to-screen view)
  await step("mind map", async () => {
    await page.goto(`${BASE}/study`, { waitUntil: "networkidle" });
    await pause(1200);
    const saved = page.locator("text=/MINDMAP|MERMAID/i").first();
    if (await saved.count()) { await saved.click(); await pause(4500); }
  });

  // 7) Learn tour (the "explain the pipeline" USP)
  await step("learn", async () => {
    await page.goto(`${BASE}/learn`, { waitUntil: "networkidle" });
    await pause(2500);
    await page.mouse.wheel(0, 900);
    await pause(2500);
  });

  await pause(800);
  await context.close(); // finalizes the video
  await browser.close();
  console.log("done");
};

run().catch((e) => { console.error(e); process.exit(1); });
