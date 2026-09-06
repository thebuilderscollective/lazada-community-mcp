import { config, urls } from "./config.js";
import {
  browserStatus,
  closeBrowser,
  getContext,
  hasBrowser,
  withPage,
} from "./browser.js";
import { sessionInfo } from "./redmart.js";
import { saveSession } from "./session.js";

let loginPending = false;
export async function returnToBackgroundAfterLogin(
  browser = { status: browserStatus, close: closeBrowser, exists: hasBrowser },
  headless = config.headless,
): Promise<boolean> {
  if (
    !headless ||
    !browser.exists() ||
    browser.status().externallyOwned ||
    browser.status().headless !== false
  )
    return false;
  await browser.close();
  return true;
}
export async function startLogin(): Promise<Record<string, unknown>> {
  if (config.loginMode === "host" && !config.cdpUrl) {
    return {
      loggedIn: false,
      started: false,
      status: "host_browser_required",
      loginUrl: urls.login(),
      message:
        "Connect this MCP to the browser on the shared desktop using LAZADA_CDP_URL, then call start_login. Opening the URL in a different browser alone cannot share the session. Nothing was ordered.",
    };
  }
  if (loginPending && hasBrowser()) {
    await withPage((page) => page.bringToFront());
    return {
      loggedIn: false,
      started: true,
      status: "awaiting_user",
      ...browserStatus(),
      nextTool: "capture_session",
      message:
        "The existing sign-in window is ready. Finish there, then call capture_session.",
    };
  }
  const existing = await sessionInfo().catch(() => ({ loggedIn: false }));
  if (existing.loggedIn)
    return {
      loggedIn: true,
      started: false,
      status: "signed_in",
      message:
        "Already signed in. This session is shared by tasks on this machine.",
    };
  if (hasBrowser() && browserStatus().headless) await closeBrowser();
  await getContext({ headless: false });
  await withPage(async (page) => {
    // Don't wait for human authentication or network-idle trackers in an MCP call.
    await page.goto(urls.login(), {
      waitUntil: "domcontentloaded",
      timeout: 15_000,
    });
    await page.bringToFront();
  });
  loginPending = true;
  return {
    loggedIn: false,
    started: true,
    status: "awaiting_user",
    loginUrl: urls.login(),
    ...browserStatus(),
    nextTool: "capture_session",
    message:
      "Sign in in the visible Lazada browser. Enter passwords, OTPs, and captcha answers only there. Then call capture_session. Other tasks reuse this session.",
  };
}
export async function captureSession(): Promise<Record<string, unknown>> {
  const session = await sessionInfo();
  if (!session.loggedIn)
    return {
      loggedIn: false,
      status: "awaiting_user",
      message:
        "Sign-in is not complete. Finish in the visible browser, then call capture_session again.",
    };
  let persisted = false;
  if (hasBrowser())
    persisted = (await saveSession(await getContext())).persisted;
  const returnedToBackground = loginPending
    ? await returnToBackgroundAfterLogin()
    : false;
  loginPending = false;
  return {
    loggedIn: true,
    status: "signed_in",
    persisted,
    returnedToBackground,
    message:
      "Signed in. All tasks using this service share the session, including after a restart. Normal local shopping runs in the background unless visible mode was explicitly configured.",
  };
}
export const login = startLogin;
