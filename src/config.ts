import { homedir } from "node:os";
import { join } from "node:path";
import { validateLazadaUrl } from "./url-policy.js";

/**
 * RedMart is Lazada Singapore's grocery arm, so the domain is fixed unless
 * someone points this at another Lazada site for plain (non-grocery) shopping.
 */
const baseUrl = validateLazadaUrl(
  process.env.LAZADA_BASE_URL ?? "https://www.lazada.sg",
  "base",
).replace(/\/$/, "");

function numericSetting(
  name: string,
  fallback: number,
  options: { min: number; max?: number },
): number {
  const value = Number(process.env[name] ?? fallback);
  if (
    !Number.isFinite(value) ||
    value < options.min ||
    (options.max !== undefined && value > options.max)
  ) {
    const range =
      options.max === undefined
        ? `at least ${options.min}`
        : `between ${options.min} and ${options.max}`;
    throw new Error(`${name} must be a finite number ${range}.`);
  }
  return value;
}

const dataDir = process.env.LAZADA_DATA_DIR ?? join(homedir(), ".lazada-mcp");
const loginMode = process.env.LAZADA_LOGIN_MODE ?? "auto";
if (!["auto", "local", "host"].includes(loginMode))
  throw new Error("LAZADA_LOGIN_MODE must be auto, local, or host.");
const hasDisplay =
  process.platform !== "linux" ||
  !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
const cdpUrl = process.env.LAZADA_CDP_URL;
if (cdpUrl) {
  const u = new URL(cdpUrl);
  if (
    !["http:", "https:", "ws:", "wss:"].includes(u.protocol) ||
    u.username ||
    u.password
  ) {
    throw new Error(
      "LAZADA_CDP_URL must be an HTTP(S) or WS(S) browser endpoint without embedded credentials.",
    );
  }
}

export const config = {
  dataDir,
  loginMode: (loginMode === "auto"
    ? hasDisplay
      ? "local"
      : "host"
    : loginMode) as "local" | "host",
  hasDisplay,
  cdpUrl,
  browserExecutable: process.env.LAZADA_BROWSER_EXECUTABLE,
  storageStatePath:
    process.env.LAZADA_STORAGE_STATE ?? join(dataDir, "storageState.json"),
  /** Base storefront, e.g. https://www.lazada.sg */
  baseUrl,

  /**
   * Persistent Chrome profile. Login (including OTP) happens once by hand and
   * the cookies live here, so the server never touches credentials itself.
   */
  profileDir: process.env.LAZADA_PROFILE_DIR ?? join(dataDir, "profile"),

  /**
   * Real Chrome is far less likely to trip Lazada's bot checks than Playwright's
   * bundled build. Set LAZADA_BROWSER_CHANNEL="" to use bundled chromium.
   */
  browserChannel:
    process.env.LAZADA_BROWSER_CHANNEL === undefined
      ? "auto"
      : process.env.LAZADA_BROWSER_CHANNEL || undefined,

  /** Routine shopping stays invisible; start_login explicitly opens the human sign-in window. */
  headless:
    process.env.LAZADA_HEADLESS === undefined
      ? true
      : process.env.LAZADA_HEADLESS === "1",

  navTimeoutMs: numericSetting("LAZADA_NAV_TIMEOUT_MS", 45_000, { min: 1_000 }),
  actionTimeoutMs: numericSetting("LAZADA_ACTION_TIMEOUT_MS", 20_000, {
    min: 1_000,
  }),

  /**
   * Hard ceiling on what a single place_order call may spend, in SGD.
   * A second guard on top of the required explicit confirmation.
   */
  maxOrderTotal: numericSetting("LAZADA_MAX_ORDER_TOTAL", 300, { min: 0.01 }),

  /** A review capability expires quickly and is always single-use. */
  reviewTokenTtlMs: numericSetting("LAZADA_REVIEW_TOKEN_TTL_MS", 5 * 60_000, {
    min: 10_000,
    max: 30 * 60_000,
  }),

  /** Where probe/debug artifacts get written. */
  debugDir: process.env.LAZADA_DEBUG_DIR ?? join(dataDir, "debug"),
} as const;

export const urls = {
  home: () => `${config.baseUrl}/`,
  redmart: () => `${config.baseUrl}/shop-groceries/`,
  /**
   * RedMart scoping is the `service=RedMart_SRP_Filter` facet on the ordinary
   * catalog — i.e. "fulfilled by RedMart", which is the whole grocery range.
   * (The `/redmart_/` path is the narrower RedMart *own-brand* filter.)
   */
  search: (q: string, page = 1, redmartOnly = true, sort?: string) =>
    `${config.baseUrl}/catalog/?q=${encodeURIComponent(q)}&page=${page}` +
    `${redmartOnly ? "&service=RedMart_SRP_Filter" : ""}${sort ? `&sort=${sort}` : ""}`,
  /** Same listing as `search`, but answering JSON instead of HTML. */
  searchAjax: (q: string, page = 1, redmartOnly = true, sort?: string) =>
    `${config.baseUrl}/catalog/?ajax=true&isFirstRequest=true&page=${page}` +
    `&q=${encodeURIComponent(q)}${redmartOnly ? "&service=RedMart_SRP_Filter" : ""}` +
    `${sort ? `&sort=${sort}` : ""}`,
  product: (itemId: string, skuId?: string | null) =>
    `${config.baseUrl}/products/pdp-i${itemId}${skuId ? `-s${skuId}` : ""}.html`,
  /** The cart lives on its own host; `www.lazada.sg/cart/` is a 404. */
  cart: () => `${config.baseUrl.replace("//www.", "//cart.")}/cart`,
  /** Checkout has its own host; the first step is the shipping page. */
  checkout: () => `${config.baseUrl.replace("//www.", "//checkout.")}/shipping`,
  /** Recent orders as JSON (HTML-entity escaped) on the account host. */
  recentOrders: () =>
    `${config.baseUrl.replace("//www.", "//my.")}/api/recentOrders/`,
  addressBook: () => `${config.baseUrl.replace("//www.", "//member.")}/address`,
  /**
   * Sign-in lives on the member host and redirects to the real form at
   * pages.lazada.sg. Note `www.lazada.sg/user/login/` is a 404.
   */
  login: () =>
    `${config.baseUrl.replace("//www.", "//member.")}/user/login` +
    `?redirect=${encodeURIComponent(config.baseUrl + "/")}`,
  /** Authoritative session check: module.userId is null when signed out. */
  contextInfo: () =>
    `${config.baseUrl.replace("//www.", "//member.")}/user/api/getContextInfo`,
  cartCount: () =>
    `${config.baseUrl.replace("//www.", "//cart.")}/cart/api/count`,
};
