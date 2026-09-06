/** A title check catches unrelated popular-item fallbacks; it is not a dietary/semantic verifier. */
const aliases: Record<string, string> = {
  crisps: "chip",
  crisp: "chip",
  chips: "chip",
  cilantro: "coriander",
  aubergine: "eggplant",
  aubergines: "eggplant",
  courgette: "zucchini",
  courgettes: "zucchini",
  garbanzo: "chickpea",
  garbanzos: "chickpea",
  chickpeas: "chickpea",
  scallion: "springonion",
  scallions: "springonion",
  yogurt: "yoghurt",
  yogurts: "yoghurt",
  yoghurts: "yoghurt",
  tomatoes: "tomato",
  potatoes: "potato",
  groceries: "grocery",
};
const noise = new Set(
  "a an the for of and or with without in to me my some buy find show compare please redmart fresh organic natural good quality premium healthy high low free no added sugar protein gluten lactose crunchy smooth unsalted salted pack packs case cases bottle bottles kg g ml l".split(
    " ",
  ),
);
// Category titles often do not contain the category itself (e.g. produce -> broccoli).
const broad = new Set(
  "grocery groceries food fruit vegetable vegetables produce pantry dairy breakfast snack snacks drink drinks beverage beverages nut nuts herb herbs seafood meat vegan vegetarian".split(
    " ",
  ),
);
function tokens(value: string): string[] {
  return (
    value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .replace(/\b(oat|almond|soy|soya|rice|coconut)\s+drinks?\b/g, "$1 milk")
      .replace(/spring\s+onions?/g, "springonion")
      .match(/[\p{L}\p{N}]+/gu)
      ?.map(
        (word) =>
          aliases[word] ??
          (/^[a-z]{4,}s$/.test(word) && !word.endsWith("ss")
            ? word.slice(0, -1)
            : word),
      ) ?? []
  );
}
export function guardSearchRelevance<T extends { name: string }>(
  products: T[],
  query: string,
) {
  const queryWords = tokens(query).filter(
    (word) => !noise.has(word) && !/^\d+$/.test(word),
  );
  const categoryOnly =
    queryWords.length === 0 || queryWords.every((word) => broad.has(word));
  if (categoryOnly)
    return {
      products,
      relevance: {
        status: "needs_review",
        rejectedCount: 0,
        note: "Broad category search: title overlap cannot verify relevance. Check each candidate in Lazada before suggesting it.",
      },
    };
  const anchors = queryWords.filter((word) => !broad.has(word));
  const matching = products.filter((product) => {
    const words = new Set(tokens(product.name));
    return anchors.some((word) => words.has(word));
  });
  return {
    products: matching,
    relevance: {
      status: matching.length ? "candidate_matches" : "no_relevant_matches",
      rejectedCount: products.length - matching.length,
      note: matching.length
        ? "Title overlap only; ingredients, nutrition, brand, and dietary requirements still need verification with get_product."
        : "No relevant matches on this Lazada results page. Unrelated popular items were excluded. This does not prove the product is unavailable across the catalog. Ask about a broader Lazada query; do not substitute external web results.",
    },
  };
}
