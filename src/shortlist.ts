import { randomUUID } from "node:crypto";
import { shoppingMemory } from "./memory.js";
import {
  addToCart,
  search,
  type Product,
  type SearchResult,
} from "./redmart.js";

export type ShortlistRequest = {
  query: string;
  quantity?: number;
  quality?: string;
};

export type ShortlistGroup = {
  groupId: string;
  query: string;
  quantity: number | null;
  quantityRequired: boolean;
  quality: string | null;
  questions: string[];
  requestedLimit: number;
  returnedCount: number;
  totalAvailable: number | null;
  candidates: Product[];
  relevance?: SearchResult["relevance"];
};

export type ProductShortlist = {
  shortlistId: string;
  expiresAt: string;
  currency: "SGD";
  groups: ShortlistGroup[];
  selection: {
    selectedCount: 0;
    estimatedSubtotal: 0;
    cartChanged: false;
    message: "Nothing has been added yet.";
  };
};

type SearchFn = typeof search;

const shortlists = new Map<string, ProductShortlist>();
const MAX_SAVED_SHORTLISTS = 50;

export async function createShortlist(
  requests: ShortlistRequest[],
  opts: {
    limitPerItem?: number;
    sort?: "popularity" | "priceasc" | "pricedesc";
    redmartOnly?: boolean;
  } = {},
  searchFn: SearchFn = search,
): Promise<ProductShortlist> {
  const limit = opts.limitPerItem ?? 3;
  const results: SearchResult[] = [];
  for (const request of requests)
    results.push(
      await searchFn(request.query, {
        limit,
        sort: opts.sort,
        redmartOnly: opts.redmartOnly,
      }),
    );

  return saveShortlist(
    requests.map((request, index) =>
      groupFromResult(request, index, results[index]),
    ),
  );
}

function groupFromResult(
  request: ShortlistRequest,
  index: number,
  result: SearchResult,
): ShortlistGroup {
  return {
    groupId: `item-${index + 1}`,
    query: request.query,
    quantity: request.quantity ?? null,
    quantityRequired: request.quantity === undefined,
    quality: request.quality ?? null,
    questions: [
      ...(request.quantity === undefined
        ? [`How many packs or units of ${request.query} would you like?`]
        : []),
      ...(!request.quality
        ? [
            `Any brand, quality, dietary, or pack-size preference for ${request.query}, or are these options suitable?`,
          ]
        : []),
    ],
    requestedLimit: result.requestedLimit,
    returnedCount: result.returnedCount,
    totalAvailable: result.totalAvailable,
    candidates: result.results,
    relevance: result.relevance,
  };
}

function saveShortlist(groups: ShortlistGroup[]): ProductShortlist {
  const shortlist: ProductShortlist = {
    shortlistId: randomUUID(),
    expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    currency: "SGD",
    groups,
    selection: {
      selectedCount: 0,
      estimatedSubtotal: 0,
      cartChanged: false,
      message: "Nothing has been added yet.",
    },
  };
  shortlists.set(shortlist.shortlistId, shortlist);
  if (shortlists.size > MAX_SAVED_SHORTLISTS) {
    shortlists.delete(shortlists.keys().next().value as string);
  }
  return shortlist;
}

export function getShortlist(shortlistId: string): ProductShortlist {
  const shortlist = shortlists.get(shortlistId);
  if (!shortlist || Date.parse(shortlist.expiresAt) <= Date.now()) {
    shortlists.delete(shortlistId);
    throw new Error(
      "That shortlist is no longer available. Call shortlist_products again.",
    );
  }
  return shortlist;
}

export type ShortlistSelection = {
  groupId: string;
  url: string;
  quantity: number;
};

export async function addShortlistToCart(args: {
  shortlistId: string;
  selections: ShortlistSelection[];
  confirm: true;
}): Promise<Record<string, unknown>> {
  if (args.confirm !== true) {
    throw new Error(
      "confirm must be true before adding shortlist choices. Nothing was added.",
    );
  }
  const shortlist = getShortlist(args.shortlistId);
  const byGroup = new Map(
    shortlist.groups.map((group) => [group.groupId, group]),
  );
  const seen = new Set<string>();

  for (const selection of args.selections) {
    const group = byGroup.get(selection.groupId);
    if (!group)
      throw new Error(
        `Unknown shortlist group ${JSON.stringify(selection.groupId)}. Nothing was added.`,
      );
    if (seen.has(selection.groupId)) {
      throw new Error(
        `Choose only one product for ${JSON.stringify(group.query)}. Nothing was added.`,
      );
    }
    seen.add(selection.groupId);
    if (
      !Number.isInteger(selection.quantity) ||
      selection.quantity < 1 ||
      selection.quantity > 50
    )
      throw new Error(
        "An explicit quantity from 1 to 50 is required. Nothing was added.",
      );
    if (
      !group.candidates.some(
        (candidate) =>
          candidate.url === selection.url && candidate.inStock !== false,
      )
    ) {
      throw new Error(
        `The selected URL is not a candidate for ${JSON.stringify(group.query)}. Nothing was added.`,
      );
    }
  }

  if (args.selections.length === 0) {
    throw new Error(
      "Select at least one product before adding to the cart. Nothing was added.",
    );
  }

  shortlists.delete(args.shortlistId); // Consume before mutations: retries cannot duplicate a partially added batch.
  const results: Array<Record<string, unknown>> = [];
  let failed = false;
  for (const selection of args.selections) {
    const group = byGroup.get(selection.groupId)!;
    if (failed) {
      results.push({
        groupId: selection.groupId,
        query: group.query,
        status: "not_attempted",
        message:
          "Skipped after an earlier item failed; cart state was not changed for this item.",
      });
      continue;
    }
    try {
      const result = await addToCart(selection.url, selection.quantity);
      const succeeded = result.ok === true;
      results.push({
        groupId: selection.groupId,
        query: group.query,
        status: succeeded ? "added" : "failed",
        result,
      });
      failed = !succeeded;
    } catch (error) {
      failed = true;
      results.push({
        groupId: selection.groupId,
        query: group.query,
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const addedCount = results.filter(
    (result) => result.status === "added",
  ).length;
  return {
    cartChanged: failed ? "unknown" : addedCount > 0,
    complete: addedCount === args.selections.length,
    requestedCount: args.selections.length,
    addedCount,
    failedCount: results.filter((result) => result.status === "failed").length,
    notAttemptedCount: results.filter(
      (result) => result.status === "not_attempted",
    ).length,
    results,
    message:
      addedCount === args.selections.length
        ? "All selected products were added. No order was placed."
        : "The batch stopped after a failure. Review each result and call get_cart before retrying. No order was placed.",
  };
}

export async function personalisedShortlist(
  requests: ShortlistRequest[],
  opts: Parameters<typeof createShortlist>[1] = {},
) {
  const shortlist = await createShortlist(requests, opts);
  // Signed-out search still works; account errors remain visible as a note.
  let memory: Awaited<ReturnType<typeof shoppingMemory>> | null = null;
  let memoryNote: string | null = null;
  try {
    memory = await shoppingMemory(false);
  } catch (e) {
    memoryNote = e instanceof Error ? e.message : String(e);
  }
  const groups = shortlist.groups.map((group) => ({
    ...group,
    savedPreference:
      memory?.preferences.find(
        (p) => p.label === group.query.trim().toLowerCase(),
      ) ?? null,
    candidates: group.candidates
      .map((product) => ({
        ...product,
        purchaseHistory:
          memory?.products.find((p) => p.itemId === product.itemId) ?? null,
      }))
      .sort(
        (a, b) =>
          (b.purchaseHistory?.ordersContaining ?? 0) -
          (a.purchaseHistory?.ordersContaining ?? 0),
      ),
  }));
  shortlist.groups = groups;
  return {
    ...shortlist,
    groups,
    memoryRefreshedAt: memory?.refreshedAt ?? null,
    memoryNote,
    nextStep:
      "Call render_product_picker in supporting clients to show the comparison table followed by labelled product-photo cards. Otherwise show a table followed by the returned images with matching names and links if inline images are supported; explain when visuals cannot render. Ask the returned questions and inspect get_product for current promotions and contentCoverage. State missing ingredient/nutrition coverage; ask before external web enrichment. Ask before increasing quantity for a deal. Nothing was added.",
  };
}
