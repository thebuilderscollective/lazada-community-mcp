import { decodeEntities } from "./extract.js";

type Row = { name: string; value: string };
function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = decodeEntities(value.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  return clean ? clean.slice(0, 12000) : null;
}
function moduleForSku(module: unknown, sku: string | null): any {
  if (!module || typeof module !== "object" || Array.isArray(module))
    return null;
  const entries = Object.entries(module);
  // A requested variant must never inherit another variant's ingredients.
  return sku
    ? ((module as Record<string, unknown>)[sku] ?? null)
    : entries.length === 1
      ? entries[0][1]
      : null;
}
/** Verified grocery module paths; retain labelled text, never infer a nutrition table from marketing. */
export function extractProductContent(
  fields: Record<string, unknown> | null,
  sku: string | null,
) {
  const details = moduleForSku(fields?.attributes_grocer, sku)?.data
    ?.attributes;
  const specs = moduleForSku(fields?.product_attributes_grocer, sku)?.data
    ?.attributes;
  const attributes: Row[] = Array.isArray(details)
    ? details.slice(0, 60).flatMap((row) => {
        const name = text(row?.title),
          value = text(row?.description?.text);
        return name && value ? [{ name, value }] : [];
      })
    : [];
  const specifications: Row[] = Array.isArray(specs)
    ? specs.slice(0, 60).flatMap((row) => {
        const name = text(row?.name),
          value = text(row?.value);
        return name && value ? [{ name, value }] : [];
      })
    : [];
  const all = [...attributes, ...specifications];
  const labelled = (pattern: RegExp) =>
    all.filter((row) => pattern.test(row.name));
  const ingredients = labelled(/^ingredients?(?:\s|$)/i);
  const nutrition = labelled(/^nutrition(?:al)?(?:\s|$)|^nutrition facts$/i);
  const description =
    attributes
      .filter((row) =>
        /^(about product|description|product description)$/i.test(row.name),
      )
      .map((row) => row.value)
      .join("\n") || null;
  return {
    description,
    ingredients,
    nutrition,
    specifications,
    attributes,
    contentCoverage: {
      source: "Lazada structured grocery attributes",
      description: description ? "available" : "unavailable",
      ingredients: ingredients.length ? "available" : "unavailable",
      nutrition: nutrition.length ? "available" : "unavailable",
      specifications: specifications.length ? "available" : "unavailable",
      note: "Only readable labelled text from this Lazada variant is included. Unavailable means not exposed here, not absent from the product. Images are not OCR'd. Dietary claims and Nutri-Grade are not an ingredient list or nutrition table. Ask the user before any external web enrichment; keep Lazada authoritative for products, price, stock, promotions, cart, and checkout.",
    },
  };
}
