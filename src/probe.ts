import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config.js";
import { closeBrowser, goto, withPage } from "./browser.js";
import { captureJson, readPageGlobals } from "./extract.js";
import { validateLazadaUrl } from "./url-policy.js";

/**
 * Lazada rewrites its markup often enough that hardcoded selectors rot. This
 * dumps everything needed to re-point them: the XHR endpoints the page calls,
 * which page globals exist, the interactive elements, and a screenshot.
 */
export async function probePage(
  url: string,
  opts: { screenshot?: boolean } = {},
): Promise<Record<string, unknown>> {
  const safeUrl = validateLazadaUrl(url, "probe");
  return withPage(async (page) => {
    const captured = await captureJson(
      page,
      /.*/,
      async () => {
        await goto(page, safeUrl);
      },
      { settleMs: 3_000 },
    );

    const jsonEndpoints = captured
      .filter(
        (h) =>
          typeof h.body === "object" &&
          h.body !== null &&
          !("_unparsed" in (h.body as object)),
      )
      .map((h) => {
        const u = new URL(h.url);
        return {
          endpoint: `${u.host}${u.pathname}`,
          topLevelKeys: Object.keys(h.body as Record<string, unknown>).slice(
            0,
            12,
          ),
        };
      })
      .slice(0, 40);

    const globals = await readPageGlobals(page).catch(() => ({}));
    const shape = await page.evaluate(() => {
      const sample = (sel: string, n: number) =>
        Array.from(document.querySelectorAll(sel))
          .slice(0, n)
          .map((el) => ({
            tag: el.tagName.toLowerCase(),
            cls: (el.getAttribute("class") ?? "").slice(0, 120),
            qa: el.getAttribute("data-qa-locator"),
            text: (el.textContent ?? "")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 80),
          }));
      return {
        productModel: (() => {
          const fields = (window as any).__moduleData__?.data?.root?.fields;
          if (!fields || typeof fields !== "object") return null;
          // Discovery only: bounded candidates, not assumed extraction paths. No account/session globals.
          return {
            modules: Object.keys(fields).slice(0, 100),
            contentCandidates: Object.fromEntries(
              Object.entries(fields)
                .filter(([key]) =>
                  /description|detail|specification|nutrition|ingredient|attributes|htmlRender/i.test(
                    key,
                  ),
                )
                .slice(0, 8)
                .map(([key, value]) => [
                  key,
                  JSON.stringify(value)?.slice(0, 18000),
                ]),
            ),
          };
        })(),
        title: document.title,
        navigation: Array.from(document.querySelectorAll("a[href]"))
          .filter((el) =>
            /address|account|delivery/i.test(el.textContent ?? ""),
          )
          .slice(0, 20)
          .flatMap((el) => {
            try {
              const u = new URL(el.getAttribute("href")!, location.href);
              if (
                u.protocol !== "https:" ||
                !(
                  u.hostname === "lazada.sg" ||
                  u.hostname.endsWith(".lazada.sg")
                )
              )
                return [];
              return [
                {
                  text: (el.textContent ?? "").trim().slice(0, 80),
                  url: u.origin + u.pathname + u.hash,
                },
              ];
            } catch {
              return [];
            }
          }),
        buttons: sample("button, a[role=button]", 30),
        qaLocators: Array.from(
          new Set(
            Array.from(document.querySelectorAll("[data-qa-locator]")).map(
              (e) => e.getAttribute("data-qa-locator"),
            ),
          ),
        ).slice(0, 40),
        bodyExcerpt: (document.body.innerText ?? "")
          .replace(/\n{2,}/g, "\n")
          .slice(0, 2_000),
      };
    });

    let screenshotPath: string | null = null;
    if (opts.screenshot !== false) {
      await mkdir(config.debugDir, { recursive: true });
      screenshotPath = join(config.debugDir, `probe-${Date.now()}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false });
    }

    const report = {
      url: page.url(),
      title: shape.title,
      navigation: shape.navigation,
      pageGlobals: Object.keys(globals),
      productModel: shape.productModel,
      jsonEndpoints,
      qaLocators: shape.qaLocators,
      buttons: shape.buttons,
      bodyExcerpt: shape.bodyExcerpt,
      screenshotPath,
    };

    if (opts.screenshot !== false) {
      await writeFile(
        join(config.debugDir, `probe-${Date.now()}.json`),
        JSON.stringify(report, null, 2),
      );
    }
    return report;
  });
}
