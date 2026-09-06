import { access, chmod, mkdir } from "node:fs/promises";
import { chromium, type BrowserContext, type Page } from "playwright";
import { parseLooseJson } from "./extract.js";
import {
  decodeApiBody,
  readSession,
  saveSession,
  sessionApiGet,
} from "./session.js";
import { config } from "./config.js";
import { validateLazadaUrl } from "./url-policy.js";

let contextPromise: Promise<BrowserContext> | null = null;
let activePage: Page | null = null;
let attachedBrowser: import("playwright").Browser | null = null;
let activeHeadless = config.headless;
let browserDescription = "not started";
export function browserStatus() {
  return {
    browser: browserDescription,
    connected: contextPromise !== null,
    externallyOwned: !!config.cdpUrl,
    headless: config.cdpUrl ? null : activeHeadless,
  };
}
export function hasBrowser() {
  return contextPromise !== null;
}
async function launch(headless: boolean): Promise<BrowserContext> {
  let ctx: BrowserContext;
  if (config.cdpUrl) {
    try {
      attachedBrowser = await chromium.connectOverCDP(config.cdpUrl, {
        timeout: 10_000,
      });
      ctx = attachedBrowser.contexts()[0];
      if (!ctx) throw new Error("no default browser context");
      // A dedicated shopping tab avoids navigating unrelated user tabs.
      activePage = await ctx.newPage();
      browserDescription = "host browser via configured CDP connection";
    } catch {
      throw new Error(
        "HOST_BROWSER_UNREACHABLE: Cannot reach LAZADA_CDP_URL. Connect the MCP to the host-visible browser; no alternative browser was opened and nothing was ordered.",
      );
    }
  } else {
    if (!headless && !config.hasDisplay)
      throw new Error(
        "DISPLAY_UNAVAILABLE: Configure LAZADA_CDP_URL for the visible host browser. Nothing was ordered.",
      );
    await mkdir(config.profileDir, { recursive: true, mode: 0o700 });
    await chmod(config.profileDir, 0o700);
    let channel = config.browserChannel;
    let executablePath = config.browserExecutable;
    if (channel === "auto" && !executablePath) {
      const candidates =
        process.platform === "darwin"
          ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
          : process.platform === "linux"
            ? [
                "/usr/bin/google-chrome",
                "/usr/bin/google-chrome-stable",
                "/usr/bin/chromium",
                "/usr/bin/chromium-browser",
              ]
            : [];
      for (const path of candidates) {
        if (
          await access(path).then(
            () => true,
            () => false,
          )
        ) {
          executablePath = path;
          break;
        }
      }
      channel = undefined;
    }
    if (executablePath) channel = undefined;
    try {
      ctx = await chromium.launchPersistentContext(config.profileDir, {
        headless,
        channel,
        executablePath,
        viewport: { width: 1440, height: 900 },
        locale: "en-SG",
        timezoneId: "Asia/Singapore",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        /processsingleton|already in use|user data directory|profile.*lock/i.test(
          message,
        )
      ) {
        throw new Error(
          "PROFILE_BUSY: An older Lazada MCP or standalone login owns this profile. Close that Lazada process once, then retry. The saved login is still valid; do not sign in again. Nothing was ordered.",
        );
      }
      throw new Error(
        "BROWSER_UNAVAILABLE: Install Chrome, set LAZADA_BROWSER_EXECUTABLE, or run npx playwright install chromium. For a VM configure LAZADA_CDP_URL. Nothing was ordered.",
      );
    }
    activeHeadless = headless;
    browserDescription = executablePath
      ? `installed browser (${executablePath})`
      : (channel ?? "bundled Chromium");
    const saved = await readSession();
    // The profile is authoritative when it already has cookies. Never replace a
    // refreshed profile with an older exported session.
    if (
      saved &&
      !(await ctx.cookies()).some((c) =>
        /(^|\.)lazada\.sg$/.test(c.domain.replace(/^\./, "")),
      )
    )
      await ctx.addCookies(saved.cookies);
    activePage = ctx.pages()[0] ?? (await ctx.newPage());
  }
  ctx.setDefaultTimeout(config.actionTimeoutMs);
  ctx.setDefaultNavigationTimeout(config.navTimeoutMs);
  ctx.on("close", () => {
    contextPromise = null;
    activePage = null;
  });
  return ctx;
}

/**
 * One shared browser for the life of the server process. A persistent profile
 * cannot be opened twice concurrently, so every tool funnels through this.
 */
export function getContext(
  opts: { headless?: boolean } = {},
): Promise<BrowserContext> {
  if (!contextPromise) {
    contextPromise = launch(opts.headless ?? config.headless).catch((err) => {
      contextPromise = null;
      throw err;
    });
  }
  return contextPromise;
}

export async function getPage(): Promise<Page> {
  const ctx = await getContext();
  if (!activePage || activePage.isClosed()) activePage = await ctx.newPage();
  return activePage;
}

export async function closeBrowser(): Promise<void> {
  if (!contextPromise) return;
  const ctx = await contextPromise.catch(() => null);
  contextPromise = null;
  if (ctx) await saveSession(ctx).catch(() => {});
  if (attachedBrowser) {
    await activePage?.close().catch(() => {});
    // Playwright disconnects CDP without shutting down the user's browser.
    await attachedBrowser.close().catch(() => {});
    attachedBrowser = null;
  } else await ctx?.close().catch(() => {});
  activePage = null;
  activeHeadless = config.headless;
}

/** Serialises tool calls; two tools driving one page at once ends badly. */
let queue: Promise<unknown> = Promise.resolve();
export function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const run = queue.then(async () => fn(await getPage()));
  queue = run.catch(() => {});
  return run;
}

export async function goto(page: Page, url: string): Promise<void> {
  const safeUrl = validateLazadaUrl(url, "internal");
  await page.goto(safeUrl, {
    waitUntil: "domcontentloaded",
    timeout: config.navTimeoutMs,
  });
  // Playwright follows redirects. Re-check the final URL so an allowlisted
  // Lazada URL cannot be used as an open redirect to an arbitrary host.
  validateLazadaUrl(page.url(), "internal");
  await page
    .waitForLoadState("networkidle", { timeout: 8_000 })
    .catch(() => {});
}

/**
 * Lazada bounces logged-out users to a login page and shows a captcha slider
 * when it dislikes the traffic. Both need a human, so surface them loudly
 * rather than returning empty results that look like "no products found".
 */
export async function assertUsable(page: Page): Promise<void> {
  const url = page.url();
  if (/\/(user|member)\/login|login-signup|login\.lazada/i.test(url)) {
    throw new Error(
      "Not logged in to Lazada. Run `npm run login` (or call the `login` tool) " +
        "to sign in once in a visible browser window; the session is then reused.",
    );
  }
  const blocked = await page
    .locator("text=/slide to verify|punish|Please verify|unusual traffic/i")
    .first()
    .isVisible()
    .catch(() => false);
  if (blocked) {
    throw new Error(
      "Lazada is showing a bot/captcha challenge. Call the `login` tool to open a " +
        "visible browser and clear it by hand, then retry.",
    );
  }
}

/**
 * Issues a request through the browser context, so it carries the logged-in
 * cookies without a page render. Lazada's `?ajax=true` storefront endpoints
 * answer plain JSON this way — far quicker and steadier than scraping markup.
 */
export async function apiGet(url: string, referer?: string): Promise<unknown> {
  if (!hasBrowser()) return sessionApiGet(url, referer);
  const ctx = await getContext();
  const safeUrl = validateLazadaUrl(url, "internal");
  const safeReferer = referer
    ? validateLazadaUrl(referer, "internal")
    : undefined;
  const res = await ctx.request.get(safeUrl, {
    headers: {
      "x-requested-with": "XMLHttpRequest",
      accept: "application/json, text/plain, */*",
      ...(safeReferer ? { referer: safeReferer } : {}),
    },
    timeout: config.navTimeoutMs,
    maxRedirects: 0,
  });
  validateLazadaUrl(res.url(), "internal");
  if (!res.ok()) throw new Error(`GET ${safeUrl} -> HTTP ${res.status()}`);
  return decodeApiBody(await res.text());
}

/**
 * Navigates and hands back the JSON body of the first matching response the
 * page itself requested. Lazada's cart API is signature-protected, so rather
 * than forging a signature we let the page make its own call and read the
 * answer off the wire.
 */
export async function gotoAndCapture(
  page: Page,
  url: string,
  pattern: RegExp,
  timeoutMs = 30_000,
): Promise<unknown | null> {
  const waiting = page
    .waitForResponse((r) => pattern.test(r.url()), { timeout: timeoutMs })
    .catch(() => null);
  await goto(page, url);
  const res = await waiting;
  if (!res) return null;
  const text = await res.text().catch(() => null);
  return text === null ? null : parseLooseJson(text);
}
