import type { Page, Response } from "playwright";

/** Anything we scrape is untrusted page content — keep it plain data. */
export type Json = unknown;

/**
 * Lazada renders catalog pages server-side and drops the model into globals.
 * The name has churned over the years, so try every one we've seen.
 */
export async function readPageGlobals(
  page: Page,
): Promise<Record<string, Json>> {
  return page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    const keys = [
      "pageData",
      "__moduleData__",
      "__INITIAL_STATE__",
      "PAGE_DATA",
      "__NEXT_DATA__",
    ];
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      if (w[k] !== undefined) {
        try {
          out[k] = JSON.parse(JSON.stringify(w[k]));
        } catch {
          /* circular or non-serialisable; skip */
        }
      }
    }
    return out;
  });
}

/** Depth-first search for the first array whose members all have the given keys. */
export function findArrayOfObjects(
  root: Json,
  requiredKeys: string[],
  maxDepth = 8,
): Record<string, Json>[] | null {
  const seen = new Set<object>();
  const walk = (node: Json, depth: number): Record<string, Json>[] | null => {
    if (depth > maxDepth || node === null || typeof node !== "object")
      return null;
    if (seen.has(node as object)) return null;
    seen.add(node as object);

    if (Array.isArray(node)) {
      const objs = node.filter(
        (n): n is Record<string, Json> =>
          !!n && typeof n === "object" && !Array.isArray(n),
      );
      if (objs.length > 0 && objs.length === node.length) {
        const hit = objs.every((o) => requiredKeys.every((k) => k in o));
        if (hit) return objs;
      }
      for (const child of node) {
        const found = walk(child, depth + 1);
        if (found) return found;
      }
      return null;
    }

    for (const value of Object.values(node as Record<string, Json>)) {
      const found = walk(value, depth + 1);
      if (found) return found;
    }
    return null;
  };
  return walk(root, 0);
}

/**
 * Runs `action` while recording JSON responses whose URL matches `pattern`.
 * More durable than DOM scraping: the page's own XHRs carry clean models even
 * when the markup around them is rewritten.
 */
export async function captureJson(
  page: Page,
  pattern: RegExp,
  action: () => Promise<void>,
  opts: { settleMs?: number } = {},
): Promise<{ url: string; body: Json }[]> {
  const hits: { url: string; body: Json }[] = [];

  const onResponse = (res: Response) => {
    const url = res.url();
    if (!pattern.test(url)) return;
    void res
      .text()
      .then((text) => {
        hits.push({ url, body: parseLooseJson(text) });
      })
      .catch(() => {});
  };

  page.on("response", onResponse);
  try {
    await action();
    await page.waitForTimeout(opts.settleMs ?? 1_500);
  } finally {
    page.off("response", onResponse);
  }
  return hits;
}

/**
 * Lazada's mtop endpoints answer with JSONP-ish `mtopjsonp1({...})` wrappers as
 * often as bare JSON, so peel the callback before parsing.
 */
export function parseLooseJson(text: string): Json {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through to JSONP unwrap */
  }
  const m = /^[\w$.]+\s*\(([\s\S]*)\)\s*;?$/.exec(trimmed);
  if (m) {
    try {
      return JSON.parse(m[1]);
    } catch {
      /* not JSONP either */
    }
  }
  return { _unparsed: trimmed.slice(0, 2_000) };
}

/** "S$12.34", "$12.34", "12.34" -> 12.34; null when there is no number. */
export function parsePrice(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw !== "string") return null;
  const m = /(\d[\d,]*(?:\.\d+)?)/.exec(raw.replace(/\s/g, ""));
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function absoluteUrl(
  href: string | null | undefined,
  base: string,
): string | null {
  if (!href) return null;
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

/** Lazada product URLs carry the item id: .../products/<slug>-i<itemId>-s<skuId>.html */
export function itemIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return /-i(\d+)(?:-s\d+)?\.html/.exec(url)?.[1] ?? null;
}

export function skuIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return /-i\d+-s(\d+)\.html/.exec(url)?.[1] ?? null;
}

/** Lazada leaves entities encoded in titles and breadcrumbs. */
export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
}
