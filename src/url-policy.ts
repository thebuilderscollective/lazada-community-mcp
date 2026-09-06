import { isIP } from "node:net";

/**
 * Every host the server may be asked to visit directly. Keep this explicit:
 * allowing arbitrary subdomains would turn get_product/probe_page into SSRF
 * primitives if a client or model supplied a hostile URL.
 */
export const LAZADA_SG_HOSTS = new Set([
  "lazada.sg",
  "www.lazada.sg",
  "cart.lazada.sg",
  "checkout.lazada.sg",
  "member.lazada.sg",
  "my.lazada.sg",
  "pages.lazada.sg",
]);

const PRODUCT_HOSTS = new Set(["lazada.sg", "www.lazada.sg"]);
// URL constructors in config replace the `www` label with service hosts.
// Restricting the configurable base to this canonical hostname keeps those
// constructors correct and avoids a superficially valid but broken setup.
const BASE_HOSTS = new Set(["www.lazada.sg"]);

export type LazadaUrlPurpose = "base" | "product" | "probe" | "internal";

function isPrivateOrLocalIp(hostname: string): boolean {
  const bareHostname =
    hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname;
  const version = isIP(bareHostname);
  if (version === 4) {
    const [a, b] = bareHostname.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a === 0
    );
  }
  if (version === 6) {
    const lower = bareHostname.toLowerCase();
    return (
      lower === "::1" ||
      lower === "::" ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      /^fe[89ab]/.test(lower)
    );
  }
  return bareHostname === "localhost" || bareHostname.endsWith(".localhost");
}

function allowedHostsFor(purpose: LazadaUrlPurpose): ReadonlySet<string> {
  if (purpose === "base") return BASE_HOSTS;
  if (purpose === "product") return PRODUCT_HOSTS;
  return LAZADA_SG_HOSTS;
}

/**
 * Validate and normalise a URL before any browser or request API receives it.
 * DNS is intentionally not resolved: only exact, known Lazada SG hostnames are
 * accepted, so DNS rebinding to a user-supplied hostname is not possible.
 */
export function validateLazadaUrl(
  raw: string,
  purpose: LazadaUrlPurpose = "internal",
): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      `Invalid URL "${raw}". Use a complete https:// Lazada Singapore URL.`,
    );
  }

  if (url.protocol !== "https:") {
    throw new Error(
      `Refusing non-HTTPS URL "${raw}". Only https:// Lazada Singapore URLs are allowed.`,
    );
  }
  if (url.username || url.password) {
    throw new Error(
      "Refusing a URL containing credentials. Sign in only in the visible Lazada browser window.",
    );
  }
  if (url.port && url.port !== "443") {
    throw new Error(
      `Refusing URL with non-standard port ${url.port}. Lazada Singapore URLs must use HTTPS port 443.`,
    );
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (isPrivateOrLocalIp(hostname)) {
    throw new Error(`Refusing local or private-network host "${hostname}".`);
  }
  if (!allowedHostsFor(purpose).has(hostname)) {
    throw new Error(
      `Host "${hostname}" is not allowed for ${purpose} URLs. Use an exact Lazada Singapore URL on: ` +
        [...allowedHostsFor(purpose)].join(", "),
    );
  }

  if (purpose === "base" && (url.pathname !== "/" || url.search)) {
    throw new Error(
      "LAZADA_BASE_URL must be exactly https://www.lazada.sg with no path or query string.",
    );
  }

  if (
    purpose === "product" &&
    !/\/products\/[^/]*-i\d+(?:-s\d+)?\.html$/i.test(url.pathname)
  ) {
    throw new Error(
      `URL path "${url.pathname}" is not a Lazada product page. Use a product URL returned by search_products.`,
    );
  }

  url.hostname = hostname;
  url.hash = "";
  return url.toString();
}

export function isCheckoutUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === "443") &&
      url.hostname.toLowerCase().replace(/\.$/, "") === "checkout.lazada.sg"
    );
  } catch {
    return false;
  }
}
