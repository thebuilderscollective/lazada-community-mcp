export type PackInfo = {
  label: string;
  count: number;
  size: number;
  unit: "ml" | "l" | "g" | "kg" | "piece";
  total: number;
};

export type UnitPrice = {
  value: number;
  currency: "SGD";
  per: "l" | "kg" | "piece";
};

function canonicalUnit(raw: string): PackInfo["unit"] {
  const unit = raw.toLowerCase();
  if (unit === "pc" || unit === "pcs" || unit.startsWith("piece"))
    return "piece";
  return unit as PackInfo["unit"];
}

/**
 * Extract only explicit mass, volume, and piece counts. Marketing sizes such
 * as "large", "10s", and banana bunch descriptions intentionally stay null.
 */
export function inferPackInfo(name: string): PackInfo | null {
  const unit = "(ml|l|g|kg|pc|pcs|piece|pieces)";
  const multi = new RegExp(
    `\\b(\\d+)\\s*[x×]\\s*(\\d+(?:\\.\\d+)?)\\s*${unit}\\b`,
    "i",
  ).exec(name);
  if (multi) {
    const count = Number(multi[1]);
    const size = Number(multi[2]);
    const canonical = canonicalUnit(multi[3]);
    if (
      Number.isFinite(count) &&
      Number.isFinite(size) &&
      count > 0 &&
      size > 0
    ) {
      return {
        label: multi[0],
        count,
        size,
        unit: canonical,
        total: count * size,
      };
    }
  }

  const reverse = new RegExp(
    `\\b(\\d+(?:\\.\\d+)?)\\s*${unit}\\s*[x×]\\s*(\\d+)\\b`,
    "i",
  ).exec(name);
  if (reverse) {
    const size = Number(reverse[1]),
      count = Number(reverse[3]);
    if (size > 0 && count > 0)
      return {
        label: reverse[0],
        count,
        size,
        unit: canonicalUnit(reverse[2]),
        total: size * count,
      };
  }
  // A carton size does not establish the total volume of a case/bundle.
  // Live search includes "Organic Oat Milk Drink 1L - Case" with no case count.
  if (/\b(case|multipack|multi-pack|bundle|pack\s+of)\b/i.test(name))
    return null;
  const single = new RegExp(`\\b(\\d+(?:\\.\\d+)?)\\s*${unit}\\b`, "i").exec(
    name,
  );
  if (!single) return null;
  const size = Number(single[1]);
  const canonical = canonicalUnit(single[2]);
  if (!Number.isFinite(size) || size <= 0) return null;
  return { label: single[0], count: 1, size, unit: canonical, total: size };
}

export function calculateUnitPrice(
  price: number | null,
  pack: PackInfo | null,
): UnitPrice | null {
  if (price === null || !Number.isFinite(price) || !pack || !(price >= 0))
    return null;

  let denominator: number;
  let per: UnitPrice["per"];
  switch (pack.unit) {
    case "ml":
      denominator = pack.total / 1_000;
      per = "l";
      break;
    case "l":
      denominator = pack.total;
      per = "l";
      break;
    case "g":
      denominator = pack.total / 1_000;
      per = "kg";
      break;
    case "kg":
      denominator = pack.total;
      per = "kg";
      break;
    case "piece":
      denominator = pack.total;
      per = "piece";
      break;
  }

  if (!(denominator > 0)) return null;
  return {
    value: Number((price / denominator).toFixed(2)),
    currency: "SGD",
    per,
  };
}

export type Deal = {
  text: string;
  minimumQuantity: number | null;
  bundlePrice: number | null;
  estimatedSavings: number | null;
  requiresApproval: true;
};
/** Interpret only explicit offers; vague discount tags never become promised savings. */
export function analyseDeals(
  promotions: string[],
  unitPrice: number | null,
): Deal[] {
  return promotions
    .filter((text) => /buy\s*\d|\d+\s*for\s*\$|multi.?buy|bundle/i.test(text))
    .map((text) => {
      const bundle =
        /(?:buy\s*)?(\d+)\s*for\s*(?:S\$|\$)\s*(\d+(?:\.\d{1,2})?)/i.exec(text);
      const buy = /buy\s*(\d+)/i.exec(text);
      const minimumQuantity = bundle
        ? Number(bundle[1])
        : buy
          ? Number(buy[1])
          : null;
      const bundlePrice = bundle ? Number(bundle[2]) : null;
      const savings =
        unitPrice !== null && minimumQuantity && bundlePrice !== null
          ? unitPrice * minimumQuantity - bundlePrice
          : null;
      return {
        text,
        minimumQuantity,
        bundlePrice,
        estimatedSavings:
          savings !== null && savings > 0 ? Number(savings.toFixed(2)) : null,
        requiresApproval: true,
      };
    });
}
