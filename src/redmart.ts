import { access } from "node:fs/promises";
import { join } from "node:path";
import { readSession } from "./session.js";
import {
  analyseDeals,
  calculateUnitPrice,
  inferPackInfo,
  type PackInfo,
  type UnitPrice,
} from "./products.js";
import type { Page } from "playwright";
import { config, urls } from "./config.js";
import {
  getContext,
  hasBrowser,
  apiGet,
  assertUsable,
  goto,
  gotoAndCapture,
  withPage,
} from "./browser.js";
import {
  assertReviewedCheckoutMatches,
  ReviewTokenStore,
  validateOrderRequest,
  type CheckoutReviewSnapshot,
} from "./checkout-confirmation.js";
import {
  absoluteUrl,
  captureJson,
  findArrayOfObjects,
  itemIdFromUrl,
  decodeEntities,
  parseLooseJson,
  parsePrice,
  readPageGlobals,
  skuIdFromUrl,
  type Json,
} from "./extract.js";
import { isCheckoutUrl, validateLazadaUrl } from "./url-policy.js";
import { guardSearchRelevance } from "./search-relevance.js";
import { extractProductContent } from "./product-content.js";

export type Product = {
  itemId: string | null;
  skuId: string | null;
  name: string;
  price: number | null;
  originalPrice: number | null;
  currency: string;
  url: string | null;
  image: string | null;
  seller: string | null;
  rating: number | null;
  reviews: number | null;
  inStock: boolean | null;
  isRedmart: boolean;
  discount: string | null;
  sold: string | null;
  pack: PackInfo | null;
  unitPrice: UnitPrice | null;
};

export type SearchResult = {
  query: string;
  page: number;
  requestedLimit: number;
  returnedCount: number;
  count: number;
  availableOnPage: number;
  totalAvailable: number | null;
  results: Product[];
  source: "ajax" | "dom";
  relevance?: ReturnType<typeof guardSearchRelevance>["relevance"];
  storefrontTotalAvailable?: number | null;
};

export type CartLine = {
  cartItemId: string | null;
  itemId: string | null;
  skuId: string | null;
  name: string;
  variant: string | null;
  quantity: number | null;
  maxQuantity: number | null;
  price: number | null;
  originalPrice: number | null;
  lineTotal: number | null;
  seller: string | null;
  /** Only ticked lines are counted in the total and carried into checkout. */
  selected: boolean;
  available: boolean;
  stockTip: string | null;
  url: string | null;
};

const CURRENCY = "SGD";
const checkoutReviewTokens = new ReviewTokenStore(config.reviewTokenTtlMs);

/** Invalidates approval whenever another MCP operation intervenes. */
export function invalidateCheckoutReview(): void {
  checkoutReviewTokens.invalidate();
}

function str(v: Json): string | null {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : null;
}

function looksRedmart(...fields: (string | null | undefined)[]): boolean {
  return fields.some((f) => !!f && /redmart/i.test(f));
}

/* ------------------------------------------------------------------ search */

/**
 * Field names confirmed against the live `/redmart_/?ajax=true` payload.
 * Note there is no productUrl on the item; the PDP link is built from itemId.
 */
export function normaliseListItem(raw: Record<string, Json>): Product {
  const itemId = str(raw.itemId) ?? str(raw.nid);
  const skuId = str(raw.skuId);
  const seller = str(raw.sellerName) ?? str(raw.brandName);
  const image = str(raw.image);
  const name = decodeEntities((str(raw.name) ?? "").trim());
  const price = parsePrice(raw.price ?? raw.priceShow);
  const pack = inferPackInfo(name);
  return {
    itemId,
    skuId,
    name,
    price,
    originalPrice: parsePrice(raw.originalPrice ?? raw.originalPriceShow),
    currency: CURRENCY,
    url: itemId ? urls.product(itemId, skuId) : null,
    image: image
      ? absoluteUrl(
          image.startsWith("//") ? `https:${image}` : image,
          config.baseUrl,
        )
      : null,
    seller,
    rating: parsePrice(raw.ratingScore),
    reviews: parsePrice(raw.review),
    inStock: typeof raw.inStock === "boolean" ? raw.inStock : null,
    isRedmart: looksRedmart(seller, str(raw.sellerId)),
    discount: str(raw.discount),
    sold: str(raw.itemSoldCntShow),
    pack,
    unitPrice: calculateUnitPrice(price, pack),
  };
}

function totalAvailableFrom(body: unknown): number | null {
  const value = (body as { mainInfo?: { totalResults?: unknown } })?.mainInfo
    ?.totalResults;
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : null;
}

export function searchResultFromPayload(
  body: unknown,
  query: string,
  page: number,
  requestedLimit: number,
): SearchResult | null {
  const direct = (body as { mods?: { listItems?: unknown } })?.mods?.listItems;
  const listItems = Array.isArray(direct)
    ? direct.filter(
        (item): item is Record<string, Json> =>
          !!item &&
          typeof item === "object" &&
          !Array.isArray(item) &&
          "itemId" in item &&
          "name" in item,
      )
    : findArrayOfObjects(body, ["itemId", "name"]);
  if (
    !listItems ||
    (Array.isArray(direct) && direct.length > 0 && listItems.length === 0)
  )
    return null;
  const available = listItems
    .map(normaliseListItem)
    .filter((product) => product.name);
  const checked = guardSearchRelevance(available, query);
  const results = checked.products.slice(0, requestedLimit);
  return {
    query,
    page,
    requestedLimit,
    returnedCount: results.length,
    count: results.length,
    availableOnPage: checked.products.length,
    totalAvailable: checked.relevance.rejectedCount
      ? null
      : totalAvailableFrom(body),
    storefrontTotalAvailable: totalAvailableFrom(body),
    relevance: checked.relevance,
    results,
    source: "ajax",
  };
}

/**
 * DOM fallback for when the ajax endpoint changes shape. Lazada's class names
 * are minified and rotate, so this keys off data attributes and structure only.
 */
async function scrapeListingDom(page: Page): Promise<Product[]> {
  const rows = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-qa-locator="product-item"]'))
      .slice(0, 60)
      .map((el) => {
        const a = el.querySelector("a[href]") as HTMLAnchorElement | null;
        const img = el.querySelector("img") as HTMLImageElement | null;
        const text = (el as HTMLElement).innerText ?? "";
        return {
          itemId: el.getAttribute("data-item-id"),
          skuSimple: el.getAttribute("data-sku-simple"),
          name: a?.getAttribute("title") ?? img?.alt ?? null,
          href: a?.getAttribute("href") ?? null,
          image: img?.getAttribute("src") ?? null,
          // Prices only ever render as $X.YZ here; first is current, second the was-price.
          prices: (text.match(/\$\s?\d[\d,]*(?:\.\d{2})?/g) ?? []).slice(0, 2),
          discount: /(\d+% Off)/.exec(text)?.[1] ?? null,
          sold: /([\d.]+[KM]? sold)/.exec(text)?.[1] ?? null,
          isRedmart:
            /redmart/i.test(text) ||
            /redmart/i.test(a?.getAttribute("title") ?? ""),
        };
      })
      .filter((r) => r.name),
  );

  return rows.map((r) => {
    const skuId = r.skuSimple?.split("-").pop() ?? null;
    const name = decodeEntities(r.name!.trim());
    const price = parsePrice(r.prices[0]);
    const pack = inferPackInfo(name);
    return {
      itemId: r.itemId,
      skuId,
      name,
      price,
      originalPrice: parsePrice(r.prices[1]),
      currency: CURRENCY,
      url: r.itemId
        ? urls.product(r.itemId)
        : absoluteUrl(
            r.href?.startsWith("//") ? `https:${r.href}` : r.href,
            config.baseUrl,
          ),
      image: r.image
        ? absoluteUrl(
            r.image.startsWith("//") ? `https:${r.image}` : r.image,
            config.baseUrl,
          )
        : null,
      seller: r.isRedmart ? "RedMart" : null,
      rating: null,
      reviews: null,
      inStock: null,
      isRedmart: r.isRedmart,
      discount: r.discount,
      sold: r.sold,
      pack,
      unitPrice: calculateUnitPrice(price, pack),
    } satisfies Product;
  });
}

export async function search(
  query: string,
  opts: {
    page?: number;
    redmartOnly?: boolean;
    limit?: number;
    sort?: string;
  } = {},
): Promise<SearchResult> {
  const pageNum = opts.page ?? 1;
  const limit = opts.limit ?? 20;
  const redmartOnly = opts.redmartOnly !== false;

  // Fast path: the storefront's own JSON endpoint, no page render needed.
  try {
    const body = await apiGet(
      urls.searchAjax(query, pageNum, redmartOnly, opts.sort),
      urls.search(query, pageNum, redmartOnly, opts.sort),
    );
    const parsed = searchResultFromPayload(body, query, pageNum, limit);
    if (parsed) return parsed;
  } catch {
    // Endpoint moved or blocked us; fall through to rendering the page.
  }

  return withPage(async (page) => {
    await goto(page, urls.search(query, pageNum, redmartOnly, opts.sort));
    await assertUsable(page);
    const results = await scrapeListingDom(page);
    if (results.length === 0) {
      const noResults = await page
        .locator("body")
        .innerText()
        .then((text) =>
          /no (?:products|results|items) found|try another search/i.test(text),
        )
        .catch(() => false);
      if (!noResults) {
        throw new Error(
          `The search page returned no product hooks for ${JSON.stringify(query)}. ` +
            "This may be a selector change; run probe_page on the search URL.",
        );
      }
    }
    const checked = guardSearchRelevance(results, query);
    const returned = checked.products.slice(0, limit);
    return {
      query,
      page: pageNum,
      requestedLimit: limit,
      returnedCount: returned.length,
      count: returned.length,
      availableOnPage: checked.products.length,
      relevance: checked.relevance,
      totalAvailable: null,
      results: returned,
      source: "dom",
    };
  });
}

/* ----------------------------------------------------------------- product */

/**
 * PDPs expose the whole model on `window.__moduleData__`. RedMart items use
 * `*_grocer` module variants, each keyed by SKU id, so the URL's SKU picks the
 * right variant and the first entry is the fallback.
 */
export async function getProduct(
  url: string,
): Promise<Record<string, unknown>> {
  const productUrl = validateLazadaUrl(url, "product");
  return withPage(async (page) => {
    await goto(page, productUrl);
    await assertUsable(page);

    const skuHint = skuIdFromUrl(page.url());
    const raw = await page.evaluate((sku: string | null) => {
      const fields = (window as any).__moduleData__?.data?.root?.fields;
      if (!fields) return null;

      const bySku = (mod: any) => {
        if (!mod || typeof mod !== "object") return null;
        if (sku && mod[sku]) return mod[sku];
        const vals = Object.values(mod);
        return vals.length ? (vals[0] as any) : null;
      };

      const priceMod = bySku(fields.price_grocer) ?? bySku(fields.price);
      const slots = bySku(fields.availability_slots_grocer);
      const promoFor = fields.promotionTags?.data
        ? ((sku && fields.promotionTags.data[sku]) ??
          Object.values(fields.promotionTags.data)[0])
        : null;
      const skuInfo = sku
        ? fields.skuInfos?.[sku]
        : (Object.values(fields.skuInfos ?? {})[0] as any);

      return {
        contentFields: {
          attributes_grocer: fields.attributes_grocer,
          product_attributes_grocer: fields.product_attributes_grocer,
        },
        title: fields.product?.title ?? null,
        brand: fields.product?.brand?.name ?? null,
        seller: fields.seller?.name ?? null,
        price: priceMod?.data?.price ?? null,
        stock: skuInfo?.stock ?? null,
        quantityInCart:
          bySku(fields.bottom_add_to_cart_grocer)?.data?.quantity ?? null,
        promotions: Array.isArray(promoFor)
          ? promoFor.map((p: any) => p?.name).filter(Boolean)
          : [],
        availableDays: Array.isArray(slots?.data?.days)
          ? slots.data.days.map((d: any) => d?.name).filter(Boolean)
          : [],
        breadcrumb: Array.isArray(fields.Breadcrumb)
          ? fields.Breadcrumb.map((b: any) => b?.title).filter(Boolean)
          : [],
      };
    }, skuHint);

    if (!raw) {
      // Model missing (layout change, or a non-grocery PDP); fall back to markup.
      const title = await page
        .locator("h1")
        .first()
        .textContent()
        .catch(() => null);
      return {
        url: page.url(),
        itemId: itemIdFromUrl(page.url()),
        skuId: skuHint,
        title: title?.trim() ?? null,
        ...extractProductContent(null, skuHint),
        warning:
          "Structured PDP data unavailable; only the title could be read. Run probe_page.",
      };
    }

    const priceObj = (raw.price ?? {}) as Record<string, Json>;
    const stock = typeof raw.stock === "number" ? raw.stock : null;

    return {
      url: page.url(),
      itemId: itemIdFromUrl(page.url()),
      skuId: skuHint,
      title:
        typeof raw.title === "string" ? decodeEntities(raw.title) : raw.title,
      brand: raw.brand,
      seller: raw.seller,
      price: parsePrice(priceObj.priceText ?? priceObj.value),
      originalPrice: parsePrice(
        priceObj.originalPriceText ?? priceObj.originalPrice,
      ),
      currency: CURRENCY,
      stock,
      inStock: stock === null ? null : stock > 0,
      quantityInCart: raw.quantityInCart,
      ...extractProductContent(raw.contentFields, skuHint),
      promotions: raw.promotions,
      deals: analyseDeals(raw.promotions, parsePrice(raw.price?.priceText)),
      promotionAdvice:
        "Offers may have eligibility conditions. Ask before increasing quantity; checkout is authoritative for discounts.",
      availableDeliveryDays: raw.availableDays,
      category: (raw.breadcrumb as string[] | undefined)
        ?.slice(0, -1)
        .map(decodeEntities),
    };
  });
}

/* -------------------------------------------------------------------- cart */

/**
 * RedMart PDPs have no "Add to Cart" button — the control is a quantity stepper
 * (`.redmart-cart-picker`) whose value *is* the cart quantity, updated live.
 * Non-grocery Lazada PDPs still use a classic button, so both are handled.
 */
const REDMART_PICKER = ".redmart-cart-picker";
const ADD_TO_CART_BUTTONS = [
  'button:has-text("Add to Cart")',
  ".pdp-button_type_addToCart",
  '[data-spm-click*="add_to_cart"]',
];

export async function addToCart(
  productUrl: string,
  quantity = 1,
): Promise<Record<string, unknown>> {
  const safeProductUrl = validateLazadaUrl(productUrl, "product");
  checkoutReviewTokens.invalidate();
  return withPage(async (page) => {
    await goto(page, safeProductUrl);
    await assertUsable(page);

    const title = (
      await page
        .locator(".pdp-mod-product-badge-title, h1")
        .first()
        .textContent()
        .catch(() => null)
    )?.trim();

    // There are two pickers (main panel and sticky bar) bound to one quantity.
    const picker = page.locator(REDMART_PICKER).first();
    if (await picker.isVisible().catch(() => false)) {
      const input = picker.locator("input").first();
      const read = async () => {
        const v = Number((await input.inputValue().catch(() => "")) || 0);
        return Number.isFinite(v) ? v : 0;
      };

      const before = await read();
      const target = before + quantity;
      const up = picker.locator(".next-number-picker-handler-up-inner").first();

      let current = before;
      for (let i = 0; i < quantity + 2 && current < target; i++) {
        await up.click({ timeout: config.actionTimeoutMs });
        await page.waitForTimeout(1_200); // each click posts its own cart update
        const now = await read();
        if (now === current) break; // stock cap or step limit
        current = now;
      }

      return {
        ok: current > before,
        product: title ?? null,
        requestedIncrease: quantity,
        quantityBefore: before,
        quantityNow: current,
        added: current - before,
        countVerified: true,
        verificationSource: "product quantity stepper",
        message:
          current >= target
            ? `Cart quantity for "${title}" is now ${current}.`
            : `Only reached ${current} of the requested ${target} — likely a stock limit.`,
      };
    }

    for (const sel of ADD_TO_CART_BUTTONS) {
      const btn = page.locator(sel).first();
      if (await btn.isVisible().catch(() => false)) {
        if (quantity !== 1) {
          throw new Error(
            "This product uses a one-click Add to Cart control, so quantities above one cannot be " +
              "verified safely on this page. Add one, then use get_cart and set_cart_quantity.",
          );
        }
        await btn.click({ timeout: config.actionTimeoutMs });
        await page.waitForTimeout(2_500);
        return {
          ok: true,
          product: title ?? null,
          requestedIncrease: 1,
          added: 1,
          countVerified: false,
          verificationSource: "add-to-cart click acknowledgement",
          message:
            "Add-to-cart clicked. Call get_cart to verify the authoritative line quantity.",
        };
      }
    }

    throw new Error(
      `No quantity stepper or Add-to-Cart button on ${page.url()}. The item may be out of stock ` +
        "or need a variant chosen first — run probe_page on this URL.",
    );
  });
}

function normaliseCartLine(fields: Record<string, Json>): CartLine {
  const price = (fields.price ?? {}) as Record<string, Json>;
  const qty = (fields.quantity ?? {}) as Record<string, Json>;
  const sku = (fields.sku ?? {}) as Record<string, Json>;
  const checkbox = (fields.checkbox ?? {}) as Record<string, Json>;

  const quantity = parsePrice(qty.quantity);
  const unit = parsePrice(price.price ?? price.currentPrice);
  const itemId = str(fields.itemId);
  const skuId = str(sku.skuId);

  return {
    cartItemId: str(fields.cartItemId),
    itemId,
    skuId,
    name: decodeEntities((str(fields.title) ?? "").trim()),
    variant: str(sku.skuText),
    quantity,
    maxQuantity: parsePrice(qty.max),
    price: unit,
    originalPrice: parsePrice(price.originPrice),
    lineTotal:
      unit !== null && quantity !== null
        ? Number((unit * quantity).toFixed(2))
        : null,
    seller: str(fields.sellerName),
    selected: checkbox.selected === true,
    available: fields.valid !== false,
    stockTip: str(fields.stockTip),
    url:
      absoluteUrl(str(fields.itemUrl), config.baseUrl) ??
      (itemId ? urls.product(itemId, skuId) : null),
  };
}

function componentsOf(
  body: unknown,
): Record<string, { tag?: string; fields?: Record<string, Json> }> {
  const data = (body as { data?: { data?: unknown } })?.data?.data;
  return data && typeof data === "object"
    ? (data as Record<string, never>)
    : {};
}

/**
 * The cart pages in batches — the first response carries ~22 lines and a
 * "LOAD MORE" control fetches the rest. Reading only the first batch silently
 * under-reports a large cart, so page through everything and merge.
 */
export async function getCart(
  opts: { loadAll?: boolean } = {},
): Promise<Record<string, unknown>> {
  return withPage(async (page) => {
    const bodies: unknown[] = [];
    const onResponse = (res: import("playwright").Response) => {
      if (!/carts\.ultron\.query/i.test(res.url())) return;
      void res
        .text()
        .then((t) => bodies.push(parseLooseJson(t)))
        .catch(() => {});
    };

    page.on("response", onResponse);
    try {
      await goto(page, urls.cart());
      await assertUsable(page);

      const hasRows = await page
        .waitForSelector(CART_ROW, { timeout: 15_000 })
        .then(() => true)
        .catch(() => false);

      if (hasRows && opts.loadAll !== false) {
        let previous = -1;
        for (let i = 0; i < 25; i++) {
          const n = await page.locator(CART_ROW).count();
          if (n === previous) break;
          previous = n;
          const more = page
            .locator("button, a, div[role=button]")
            .filter({ hasText: /^\s*load more\s*$/i })
            .first();
          if (await more.isVisible().catch(() => false)) {
            await more.click({ timeout: 8_000 }).catch(() => {});
          } else {
            await page.evaluate(() =>
              window.scrollTo(0, document.body.scrollHeight),
            );
          }
          await page.waitForTimeout(2_200);
        }
      }
      await page.waitForTimeout(1_200);
    } finally {
      page.off("response", onResponse);
    }

    if (bodies.length === 0) {
      throw new Error(
        `Could not capture any cart response from ${urls.cart()}. Run probe_page on that URL.`,
      );
    }

    // Later batches repeat earlier lines, so key by cartItemId to dedupe.
    const byId = new Map<string, CartLine>();
    let totalFields: Record<string, Json> = {};
    let summaryFields: Record<string, Json> = {};

    for (const body of bodies) {
      for (const comp of Object.values(componentsOf(body))) {
        if (comp?.tag === "item" && comp.fields) {
          const line = normaliseCartLine(comp.fields);
          byId.set(line.cartItemId ?? `${line.itemId}:${line.skuId}`, line);
        } else if (comp?.tag === "orderTotal" && comp.fields) {
          totalFields = comp.fields;
        } else if (comp?.tag === "orderSummary" && comp.fields) {
          summaryFields = comp.fields;
        }
      }
    }

    const lines = [...byId.values()];
    const payment = (totalFields.payment ?? {}) as Record<string, Json>;
    const summaries = Array.isArray(summaryFields.summarys)
      ? (summaryFields.summarys as Record<string, Json>[]).map((r) => ({
          label: str(r.title),
          value: str(r.value),
          note: str(r.tail),
        }))
      : [];
    const selected = lines.filter((l) => l.selected);

    return {
      lineCount: lines.length,
      totalUnits: lines.reduce((n, l) => n + (l.quantity ?? 0), 0),
      selectedCount: selected.length,
      batchesLoaded: bodies.length,
      lines,
      totals: {
        // Lazada charges only for ticked lines, so this is the figure that matters.
        selectedTotal: parsePrice(payment.pay),
        selectedTotalText: str(payment.pay),
        breakdown: summaries,
        currency: CURRENCY,
      },
      checkoutButton: str(
        ((totalFields.button ?? {}) as Record<string, Json>).text,
      ),
      note:
        selected.length === 0 && lines.length > 0
          ? "No lines are ticked, so the cart total reads $0.00. Only ticked lines go to checkout."
          : undefined,
    };
  });
}

/**
 * The cart page ships explicit `automation-*` hooks alongside Alibaba's `next-*`
 * design-system classes. Both are far steadier than the minified layout classes,
 * so all cart mutations key off them.
 */
const CART_ROW = ".cart-item-inner";

async function cartRow(page: Page, itemName: string) {
  const row = page.locator(CART_ROW).filter({ hasText: itemName }).first();
  if (!(await row.isVisible().catch(() => false))) {
    throw new Error(
      `No cart line matching "${itemName}". Call get_cart to see exact names.`,
    );
  }
  return row;
}

export async function setCartQuantity(
  itemName: string,
  quantity: number,
): Promise<{ ok: boolean; message: string }> {
  checkoutReviewTokens.invalidate();
  return withPage(async (page) => {
    await goto(page, urls.cart());
    await assertUsable(page);
    await page.waitForSelector(CART_ROW, { timeout: config.actionTimeoutMs });

    const row = await cartRow(page, itemName);
    const input = row.locator('input[type="text"]').first();
    const current = Number((await input.inputValue().catch(() => "")) || 0);
    if (!Number.isFinite(current) || current === 0) {
      throw new Error(`Could not read the current quantity for "${itemName}".`);
    }
    if (current === quantity)
      return { ok: true, message: `"${itemName}" is already at ${quantity}.` };

    const stepper = row
      .locator(
        quantity > current
          ? ".next-number-picker-handler-up-inner"
          : ".next-number-picker-handler-down-inner",
      )
      .first();

    for (let i = 0; i < Math.abs(quantity - current); i++) {
      await stepper.click({ timeout: config.actionTimeoutMs });
      await page.waitForTimeout(900); // each step fires its own cart update
    }

    const now = Number((await input.inputValue().catch(() => "")) || 0);
    return {
      ok: now === quantity,
      message:
        now === quantity
          ? `"${itemName}": ${current} -> ${quantity}.`
          : `Asked for ${quantity} but the line now reads ${now} (stock limit or step size).`,
    };
  });
}

export async function removeFromCart(
  itemName: string,
): Promise<{ ok: boolean; message: string }> {
  checkoutReviewTokens.invalidate();
  return withPage(async (page) => {
    await goto(page, urls.cart());
    await assertUsable(page);
    await page.waitForSelector(CART_ROW, { timeout: config.actionTimeoutMs });

    const row = await cartRow(page, itemName);
    await row
      .locator(".automation-btn-delete")
      .first()
      .click({ timeout: config.actionTimeoutMs });
    await page.waitForTimeout(1_500);

    // Deletion confirms through an in-page dialog, not a native confirm().
    const confirm = page
      .locator(
        '.next-dialog button:has-text("Yes"), .next-dialog button:has-text("Confirm"), ' +
          '.next-dialog button:has-text("OK"), .next-dialog button:has-text("Remove")',
      )
      .first();
    if (await confirm.isVisible().catch(() => false)) {
      await confirm.click();
      await page.waitForTimeout(1_500);
    }

    const stillThere = await page
      .locator(CART_ROW)
      .filter({ hasText: itemName })
      .first()
      .isVisible()
      .catch(() => false);
    return {
      ok: !stillThere,
      message: stillThere
        ? `"${itemName}" still appears in the cart.`
        : `Removed "${itemName}".`,
    };
  });
}

/**
 * Lazada carries only *ticked* lines into checkout, so selection is a required
 * step in the ordering path, not a nicety.
 */
export async function selectCartItems(args: {
  itemNames?: string[];
  all?: boolean;
  none?: boolean;
}): Promise<Record<string, unknown>> {
  const modes =
    Number(Boolean(args.itemNames?.length)) +
    Number(args.all === true) +
    Number(args.none === true);
  if (modes !== 1) {
    throw new Error(
      "Pass exactly one of a non-empty item_names list, all=true, or none=true.",
    );
  }
  checkoutReviewTokens.invalidate();
  return withPage(async (page) => {
    await goto(page, urls.cart());
    await assertUsable(page);
    await page.waitForSelector(CART_ROW, { timeout: config.actionTimeoutMs });

    const setRow = async (row: ReturnType<Page["locator"]>, want: boolean) => {
      const box = row.locator('input[type="checkbox"]').first();
      if ((await box.isChecked().catch(() => null)) === want) return false;

      // The real input sits on top of the styled span, and a sticky site header
      // can cover a row mid-scroll — so drive the input, forcing past overlaps.
      await box.scrollIntoViewIfNeeded().catch(() => {});
      try {
        await (want
          ? box.check({ timeout: 8_000 })
          : box.uncheck({ timeout: 8_000 }));
      } catch {
        await box.click({ force: true, timeout: 8_000 });
      }
      await page.waitForTimeout(900);
      return true;
    };

    let changed = 0;
    if (args.all || args.none) {
      const want = !!args.all;
      const rows = page.locator(CART_ROW);
      const n = await rows.count();
      for (let i = 0; i < n; i++) {
        if (await setRow(rows.nth(i), want)) changed++;
      }
    } else if (args.itemNames?.length) {
      for (const name of args.itemNames) {
        if (await setRow(await cartRow(page, name), true)) changed++;
      }
    }

    await page.waitForTimeout(1_500);
    const button = await page
      .locator("button")
      .filter({ hasText: /proceed to checkout/i })
      .first()
      .textContent()
      .catch(() => null);

    // Re-read rather than trusting the click count: the page re-renders rows as
    // it saves, so only a fresh read states the selection truthfully.
    const boxes = page.locator(`${CART_ROW} input[type="checkbox"]`);
    const total = await boxes.count();
    let nowSelected = 0;
    for (let i = 0; i < total; i++) {
      if (
        await boxes
          .nth(i)
          .isChecked()
          .catch(() => false)
      )
        nowSelected++;
    }

    return {
      toggled: changed,
      selectedNow: nowSelected,
      ofLoadedRows: total,
      checkoutButton: button?.trim() ?? null,
      note: "Only rows loaded on the page were counted; use get_cart for the authoritative list.",
    };
  });
}

/* ---------------------------------------------------------------- checkout */

const PLACE_ORDER_CONTAINER = ".checkout-order-total";
const DELIVERY_OPTION = ".delivery-item-inner";

/** Reads the checkout summary rows and the grand total from the page. */
async function readCheckoutSummary(page: Page) {
  return page.evaluate(() => {
    const clean = (s: string | null | undefined) =>
      (s ?? "").replace(/\s+/g, " ").trim();
    const rows = Array.from(document.querySelectorAll(".checkout-summary-row"))
      .map((el) => clean((el as HTMLElement).innerText))
      .filter(Boolean)
      .slice(0, 12);
    const totalBlock = clean(
      (document.querySelector(".checkout-order-total") as HTMLElement)
        ?.innerText,
    );
    const body = clean(document.body.innerText);
    const address =
      /Shipping Address\s*Edit\s*(.+?)(?:Package|Choose your delivery)/i.exec(
        body,
      )?.[1] ?? null;
    const payment =
      /Select payment method.*?(?:View all methods >)?\s*(\*+\d+|Lazada Wallet|Cash on Delivery)/i.exec(
        body,
      )?.[1] ?? null;
    // The same option repeats across package sliders; collapse by label.
    const seen = new Set<string>();
    const options: { text: string; selected: boolean }[] = [];
    for (const el of Array.from(
      document.querySelectorAll(".delivery-item-inner"),
    )) {
      const text = clean((el as HTMLElement).innerText).slice(0, 120);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      options.push({
        text,
        selected: /delivery-item-selected/.test(el.className),
      });
    }
    const items = Array.from(
      document.querySelectorAll(".automation-item-quantity"),
    ).map((el) => {
      let node: HTMLElement | null = el as HTMLElement;
      let summary = clean(node.innerText);
      const identities: string[] = [];
      for (
        let depth = 0;
        node && depth < 6;
        depth++, node = node.parentElement
      ) {
        for (const attr of [
          "data-item-id",
          "data-sku-id",
          "data-sku",
          "data-itemid",
        ]) {
          const value = node.getAttribute(attr);
          if (value) identities.push(`${attr}:${value}`);
        }
        const text = clean(node.innerText);
        // Keep the smallest surrounding block that contains useful product
        // detail. Avoid the whole package/page, which may contain timers.
        if (text.length > summary.length && text.length <= 600) summary = text;
      }
      const quantity = clean(
        (el as HTMLInputElement).value ||
          (el as HTMLElement).innerText ||
          el.textContent ||
          el.getAttribute("aria-valuenow") ||
          el.getAttribute("value"),
      );
      return {
        identity: identities.length
          ? [...new Set(identities)].sort().join("|")
          : null,
        quantity,
        summary: summary.slice(0, 600),
      };
    });
    return {
      rows,
      totalBlock,
      address,
      payment,
      options,
      items,
      itemCount: items.length,
    };
  });
}

/** Pulls the grand total out of the order-total block, e.g. "Total: $24.09". */
function totalFromBlock(block: string | null): number | null {
  if (!block) return null;
  const m = /total:?\s*\$?\s*([\d,]+\.\d{2})/i.exec(block);
  return m ? parsePrice(m[1]) : null;
}

function checkoutSnapshot(
  summary: Awaited<ReturnType<typeof readCheckoutSummary>>,
  total: number,
): CheckoutReviewSnapshot {
  return {
    basket: summary.items,
    deliverTo: summary.address?.replace(/\s+/g, " ").trim() ?? null,
    paymentMethod: summary.payment,
    deliverySelection: summary.options
      .filter((option) => option.selected)
      .map((option) => option.text),
    feeSummary: summary.rows,
    totalBlock: summary.totalBlock,
    total,
    currency: CURRENCY,
  };
}

/**
 * Always reaches checkout the way a person does: from the cart, via PROCEED TO
 * CHECKOUT. Navigating to /shipping directly can render a stale checkout
 * session left over from an earlier visit — which would show an order that has
 * nothing to do with the current cart selection.
 */
export async function reviewCheckout(): Promise<Record<string, unknown>> {
  checkoutReviewTokens.invalidate();
  return withPage(async (page) => {
    await goto(page, urls.cart());
    await assertUsable(page);
    const hasRows = await page
      .waitForSelector(CART_ROW, { timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (!hasRows)
      throw new Error(
        "The cart appears to be empty; there is nothing to check out.",
      );

    const button = page
      .locator("button")
      .filter({ hasText: /proceed to checkout/i })
      .first();
    const label = (await button.textContent().catch(() => null))?.trim() ?? "";
    const ticked = Number(/\((\d+)\)/.exec(label)?.[1] ?? 0);

    if (ticked === 0) {
      throw new Error(
        `Nothing is ticked in the cart ("${label}"), so there is nothing to check out. ` +
          "Choose lines with select_cart_items first.",
      );
    }

    // Capture the cart's own figure so the checkout total can be cross-checked.
    const cartSnapshot = await getCartTotalsFromPage(page);

    await button.click({ timeout: config.actionTimeoutMs });
    await page.waitForTimeout(9_000);
    await assertUsable(page);

    if (!isCheckoutUrl(page.url())) {
      throw new Error(
        `Expected to land on checkout but ended up at ${page.url()}. Nothing was ordered.`,
      );
    }

    const summary = await readCheckoutSummary(page);
    const total = totalFromBlock(summary.totalBlock);

    if (summary.itemCount === 0 || total === null) {
      throw new Error(
        "The checkout page shows no order lines or no total. Nothing was ordered. Run probe_page " +
          `on ${page.url()}.`,
      );
    }

    const slotStillNeeded = summary.options.some(
      (option) =>
        /select your preferred slot/i.test(option.text) && option.selected,
    );
    const deliverySelection = summary.options.filter(
      (option) => option.selected,
    );
    const reviewBlockers: string[] = [];
    if (deliverySelection.length === 0)
      reviewBlockers.push("selected delivery option could not be read");
    if (slotStillNeeded)
      reviewBlockers.push("delivery time slot is still required");
    if (!summary.address?.trim())
      reviewBlockers.push("delivery address could not be read");
    if (!summary.payment?.trim())
      reviewBlockers.push("payment method could not be read");
    if (summary.rows.length === 0)
      reviewBlockers.push("fee summary could not be read");
    if (summary.items.some((item) => !item.quantity || !item.summary)) {
      reviewBlockers.push(
        "one or more basket lines could not be read completely",
      );
    }

    const grant =
      reviewBlockers.length === 0
        ? checkoutReviewTokens.issue(checkoutSnapshot(summary, total))
        : null;

    return {
      url: page.url(),
      ticketedLines: ticked,
      checkoutItemCount: summary.itemCount,
      basket: summary.items,
      cartSelectedTotal: cartSnapshot,
      deliverTo: summary.address?.replace(/\s+/g, " ").trim() ?? null,
      paymentMethod: summary.payment,
      deliveryOptions: summary.options,
      slotStillNeeded,
      summary: summary.rows,
      total,
      currency: CURRENCY,
      readyToPlace: grant !== null,
      reviewBlockers,
      reviewToken: grant?.token ?? null,
      reviewTokenExpiresAt: grant
        ? new Date(grant.expiresAt).toISOString()
        : null,
      nextStep: grant
        ? "NOTHING HAS BEEN ORDERED. Show the basket, delivery selection, fees, address, payment " +
          "method, and total to the user. Only after they explicitly approve this exact review, call " +
          `place_order once with confirm=true, expected_total=${total}, and this review_token. ` +
          "Do not call another shopping tool or navigate away first."
        : "NOTHING HAS BEEN ORDERED. No confirmation token was issued because: " +
          `${reviewBlockers.join("; ")}. Resolve these blockers, run review_checkout again, and ` +
          "obtain the user's approval of that new complete review.",
    };
  });
}

/** Reads the cart's own selected-total text without leaving the page. */
async function getCartTotalsFromPage(page: Page): Promise<string | null> {
  return page
    .evaluate(() => {
      const el = document.querySelector(
        '[class*="checkout-summary"], [class*="order-total"]',
      );
      const t = (el as HTMLElement | null)?.innerText ?? "";
      return /\$\s?[\d,]+\.\d{2}/.exec(t)?.[0] ?? null;
    })
    .catch(() => null);
}

export async function listDeliverySlots(): Promise<Record<string, unknown>> {
  return withPage(async (page) => {
    if (!isCheckoutUrl(page.url()))
      throw new Error(
        "Run review_checkout from the cart before reading or changing delivery options. Nothing was ordered.",
      );
    await assertUsable(page);
    await page.waitForTimeout(4_000);

    const options = await page.evaluate(() => {
      const seen = new Set<string>();
      const out: {
        index: number;
        text: string;
        selected: boolean;
        needsSlot: boolean;
      }[] = [];
      for (const el of Array.from(
        document.querySelectorAll(".delivery-item-inner"),
      )) {
        const inner = (el as HTMLElement).innerText ?? "";
        const text = inner.replace(/\s+/g, " ").trim().slice(0, 140);
        if (!text || seen.has(text)) continue; // repeated across package sliders
        seen.add(text);
        out.push({
          index: out.length,
          text,
          selected: /delivery-item-selected/.test(el.className),
          needsSlot: /select your preferred slot/i.test(inner),
        });
      }
      return out;
    });

    return {
      count: options.length,
      options,
      note:
        "RedMart asks for a delivery option first, then a time slot within it. " +
        "`needsSlot` means a time still has to be picked for that option.",
    };
  });
}

export async function selectDeliverySlot(
  match: string,
): Promise<Record<string, unknown>> {
  checkoutReviewTokens.invalidate();
  return withPage(async (page) => {
    if (!isCheckoutUrl(page.url()))
      throw new Error(
        "Run review_checkout from the cart before reading or changing delivery options. Nothing was ordered.",
      );
    await assertUsable(page);
    await page.waitForTimeout(4_000);

    const option = page
      .locator(DELIVERY_OPTION)
      .filter({ hasText: match })
      .first();
    if (!(await option.isVisible().catch(() => false))) {
      throw new Error(
        `No delivery option matching "${match}". Call list_delivery_slots first.`,
      );
    }
    await option.click({ timeout: config.actionTimeoutMs });
    await page.waitForTimeout(3_000);

    // Picking an option may open a time-slot panel that also needs a choice.
    const slot = page
      .locator(
        '[class*="slot-item"], [class*="time-slot"] li, [class*="timeslot-item"]',
      )
      .filter({ hasNotText: /sold out|unavailable|full/i })
      .first();
    let pickedTime: string | null = null;
    if (await slot.isVisible().catch(() => false)) {
      pickedTime =
        (await slot.textContent().catch(() => null))
          ?.replace(/\s+/g, " ")
          .trim() ?? null;
      await slot.click({ timeout: config.actionTimeoutMs }).catch(() => {});
      await page.waitForTimeout(2_000);
      const confirm = page
        .locator(
          'button:has-text("Confirm"), button:has-text("Done"), button:has-text("Save")',
        )
        .first();
      if (await confirm.isVisible().catch(() => false)) {
        await confirm.click().catch(() => {});
        await page.waitForTimeout(2_000);
      }
    }

    const after = await readCheckoutSummary(page);
    return {
      ok: true,
      matched: match,
      timeSlotPicked: pickedTime,
      deliveryOptions: after.options,
      total: totalFromBlock(after.totalBlock),
    };
  });
}

export async function placeOrder(args: {
  confirm: boolean;
  expectedTotal: number;
  tolerance?: number;
  reviewToken: string;
}): Promise<Record<string, unknown>> {
  const { tolerance } = validateOrderRequest(args, config.maxOrderTotal);
  // Consume before checking page state. A failed or abandoned attempt cannot be
  // replayed; the safe recovery is always a new review and fresh approval.
  const grant = checkoutReviewTokens.consume(args.reviewToken);

  return withPage(async (page) => {
    // Deliberately does not navigate: reaching checkout by URL can resurrect a
    // stale session, and ordering the wrong basket is unrecoverable.
    if (!isCheckoutUrl(page.url())) {
      throw new Error(
        `Not on the checkout page (currently ${page.url()}). Run review_checkout immediately ` +
          "before place_order, and do not call other tools in between. Nothing was ordered.",
      );
    }
    await assertUsable(page);

    const summary = await readCheckoutSummary(page);
    const actual = totalFromBlock(summary.totalBlock);

    if (summary.itemCount === 0) {
      throw new Error("The checkout page lists no items. Nothing was ordered.");
    }

    if (actual === null) {
      throw new Error(
        "Could not read the order total from the checkout page, so it could not be verified " +
          "against expected_total. Refusing to place the order. Run review_checkout again.",
      );
    }
    if (
      summary.options.some(
        (option) =>
          /select your preferred slot/i.test(option.text) && option.selected,
      )
    ) {
      throw new Error(
        "A delivery time slot is still required. Run review_checkout again; nothing was ordered.",
      );
    }

    assertReviewedCheckoutMatches({
      grant,
      liveSnapshot: checkoutSnapshot(summary, actual),
      expectedTotal: args.expectedTotal,
      tolerance,
      currentUrl: page.url(),
    });

    const button = page
      .locator(`${PLACE_ORDER_CONTAINER} :text("PLACE ORDER")`)
      .first();
    if (!(await button.isVisible().catch(() => false))) {
      throw new Error(
        `No "PLACE ORDER NOW" control found on ${page.url()}. Nothing was ordered. Use probe_page.`,
      );
    }

    await button.click({ timeout: config.actionTimeoutMs });
    await page.waitForTimeout(8_000);

    return {
      placed: true,
      chargedTotal: actual,
      currency: CURRENCY,
      landedOn: page.url(),
      note:
        "Order submitted. If the bank asks for 3-D Secure or an OTP, finish it in the visible " +
        "browser window. Confirm with list_orders.",
    };
  });
}

/* ------------------------------------------------------------------ orders */

export async function listOrders(limit = 10): Promise<Record<string, unknown>> {
  // The account host serves recent orders as JSON, but HTML-entity escaped.
  const raw = await apiGet(urls.recentOrders(), urls.home()).catch(() => null);
  let parsed: unknown = raw;
  if (
    typeof raw === "object" &&
    raw !== null &&
    "_unparsed" in (raw as object)
  ) {
    const text = (raw as { _unparsed: string })._unparsed;
    try {
      parsed = JSON.parse(decodeEntities(text));
    } catch {
      parsed = null;
    }
  }

  const orders = (parsed as { module?: unknown })?.module;
  if (!Array.isArray(orders)) {
    throw new Error(`Could not read orders from ${urls.recentOrders()}.`);
  }

  return {
    count: orders.length,
    orders: orders.slice(0, limit).map((o: Record<string, Json>) => ({
      orderId: str(o.tradeOrderId),
      createdAt: str(o.createdAt),
      itemCount: Array.isArray(o.items) ? o.items.length : null,
      items: Array.isArray(o.items)
        ? (o.items as Record<string, Json>[])
            .map((i) => decodeEntities(str(i.title) ?? ""))
            .filter(Boolean)
        : [],
    })),
    note: "Recent orders only — Lazada's account API does not page further back here.",
  };
}

/* ------------------------------------------------------------------- login */

/**
 * Authoritative session check. The old heuristic — "is there a login link?" —
 * gave false positives, so ask the member API directly: userId is null when
 * signed out and populated when signed in.
 */
export async function sessionInfo(): Promise<{
  loggedIn: boolean;
  userId: string | null;
}> {
  if (!hasBrowser() && !(await readSession())) {
    const profileExists = await access(
      join(config.profileDir, "Default", "Cookies"),
    ).then(
      () => true,
      () => false,
    );
    if (config.cdpUrl || profileExists) await getContext();
    else return { loggedIn: false, userId: null };
  }
  const body = (await apiGet(urls.contextInfo(), urls.home())) as {
    module?: { userId?: unknown };
  };
  if (!body?.module || !("userId" in body.module))
    throw new Error(
      "SESSION_UNREADABLE: Lazada session API changed or returned a challenge. Call start_login; nothing was ordered.",
    );
  const userId = body.module.userId;
  return {
    loggedIn: userId !== null && userId !== undefined && userId !== "",
    userId: userId == null ? null : String(userId),
  };
}
export async function whoami(): Promise<Record<string, unknown>> {
  const session = await sessionInfo();
  return {
    loggedIn: session.loggedIn,
    status: session.loggedIn ? "signed_in" : "signed_out",
    sharedAcrossTasks: true,
    message: session.loggedIn
      ? "Signed in. Tasks on this machine share the session."
      : "Call start_login to connect Lazada in the visible browser.",
  };
}

/* --------------------------------------------------- addresses & timeslots */

export async function listAddresses(): Promise<Record<string, unknown>> {
  return withPage(async (page) => {
    // The member-host address book requests its own address API. The old
    // my-host route renders only an empty account shell and must not be used.
    const captured = await captureJson(
      page,
      /address/i,
      async () => {
        await goto(page, urls.addressBook());
      },
      { settleMs: 5_000 },
    );
    await assertUsable(page);

    for (const hit of captured) {
      const arr =
        findArrayOfObjects(hit.body, ["addressId"]) ??
        findArrayOfObjects(hit.body, ["detailAddress"]) ??
        findArrayOfObjects(hit.body, ["addressDetail"]);
      if (arr?.length) {
        return { source: `xhr:${new URL(hit.url).pathname}`, addresses: arr };
      }
    }

    throw new Error(
      "The address book did not expose a readable address list. Use review_checkout to inspect the actual delivery address from the selected cart. Nothing was ordered.",
    );
  });
}
