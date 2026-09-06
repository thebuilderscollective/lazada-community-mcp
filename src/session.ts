import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { request, type BrowserContext } from "playwright";
import { config } from "./config.js";
import { validateLazadaUrl } from "./url-policy.js";
import { decodeEntities, parseLooseJson } from "./extract.js";

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;
export function lazadaState(raw: unknown): StorageState {
  if (
    !raw ||
    typeof raw !== "object" ||
    !Array.isArray((raw as StorageState).cookies)
  ) {
    throw new Error(
      "Session file must be a Playwright storageState object. Never paste cookies into chat.",
    );
  }
  const cookies = (raw as StorageState).cookies.filter((c) => {
    const domain = c.domain?.replace(/^\./, "");
    return (
      typeof domain === "string" &&
      (domain === "lazada.sg" || domain.endsWith(".lazada.sg"))
    );
  });
  if (
    cookies.some(
      (c) =>
        typeof c.name !== "string" ||
        typeof c.value !== "string" ||
        !c.path ||
        !Number.isFinite(c.expires),
    )
  ) {
    throw new Error(
      "Session file contains malformed cookies. Capture a new session in the browser.",
    );
  }
  return { cookies, origins: [] };
}
export async function readSession(): Promise<StorageState | null> {
  try {
    return lazadaState(
      JSON.parse(await readFile(config.storageStatePath, "utf8")),
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}
export async function saveSession(
  ctx: BrowserContext,
): Promise<{ persisted: boolean }> {
  const state = lazadaState(await ctx.storageState());
  const path = config.storageStatePath;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(state), { mode: 0o600 });
  await rename(temp, path);
  await chmod(path, 0o600);
  return { persisted: true };
}
export function decodeApiBody(text: string): unknown {
  let parsed = parseLooseJson(text);
  if (parsed && typeof parsed === "object" && "_unparsed" in parsed)
    parsed = parseLooseJson(decodeEntities(text));
  if (parsed === null || (typeof parsed === "object" && "_unparsed" in parsed))
    throw new Error(
      "Lazada returned an unreadable response or a challenge. Call start_login to inspect the session; nothing was ordered.",
    );
  return parsed;
}
/** Playwright's cookie jar respects domain, path, expiry, and redirects. No raw Cookie header. */
export async function sessionApiGet(
  url: string,
  referer?: string,
): Promise<unknown> {
  const state = await readSession();
  const ctx = await request.newContext({ storageState: state ?? undefined });
  try {
    const response = await ctx.get(validateLazadaUrl(url), {
      headers: {
        "x-requested-with": "XMLHttpRequest",
        ...(referer ? { referer: validateLazadaUrl(referer) } : {}),
      },
      maxRedirects: 0,
      timeout: config.navTimeoutMs,
    });
    if (!response.ok())
      throw new Error(
        `Lazada session check returned HTTP ${response.status()}. Call start_login; nothing was ordered.`,
      );
    return decodeApiBody(await response.text());
  } finally {
    await ctx.dispose();
  }
}
