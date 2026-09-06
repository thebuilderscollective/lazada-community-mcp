import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config, urls } from "./config.js";
import { apiGet } from "./browser.js";
import { decodeEntities } from "./extract.js";
import { sessionInfo } from "./redmart.js";
import { validateLazadaUrl } from "./url-policy.js";

export type HistoryItem = { itemId: string; name: string; occurrences: number };
export type HistoryOrder = {
  orderId: string;
  createdAt: string | null;
  items: HistoryItem[];
};
export type Preference = {
  label: string;
  url: string;
  quality: string | null;
  quantity: number | null;
  updatedAt: string;
};
export type ShoppingMemory = {
  version: 1;
  refreshedAt: string | null;
  orders: HistoryOrder[];
  preferences: Preference[];
};
export function normaliseOrders(raw: unknown): HistoryOrder[] {
  const orders = (raw as { success?: boolean; module?: unknown })?.module;
  if (!Array.isArray(orders))
    throw new Error(
      "Recent-order response changed. Run probe_page on the account page; nothing was ordered.",
    );
  return orders.map((o) => {
    if (!o.tradeOrderId || !Array.isArray(o.items))
      throw new Error(
        "Recent order lacks its identifier or items. History was not updated.",
      );
    const items = new Map<string, HistoryItem>();
    for (const row of o.items) {
      if (!row.itemId || !row.title)
        throw new Error(
          "Order item has no identity or title. History was not updated.",
        );
      const id = String(row.itemId);
      const entry = items.get(id) ?? {
        itemId: id,
        name: decodeEntities(String(row.title)),
        occurrences: 0,
      };
      entry.occurrences++;
      items.set(id, entry);
    }
    return {
      orderId: String(o.tradeOrderId),
      createdAt: o.createdAt ? String(o.createdAt) : null,
      items: [...items.values()],
    };
  });
}
export function mergeOrders(
  old: HistoryOrder[],
  incoming: HistoryOrder[],
): HistoryOrder[] {
  const merged = new Map(old.map((order) => [order.orderId, order]));
  for (const order of incoming) merged.set(order.orderId, order);
  return [...merged.values()].slice(-2000);
}
export function summariseHistory(orders: HistoryOrder[]) {
  const products = new Map<
    string,
    {
      itemId: string;
      name: string;
      ordersContaining: number;
      observedOccurrences: number;
      lastOrderedAt: string | null;
      url: string;
      typicalQuantity: null;
    }
  >();
  const dateKey = (s: string | null) => {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s ?? "");
    return m ? `${m[3]}-${m[2]}-${m[1]}` : (s ?? "");
  };
  for (const order of new Map(orders.map((o) => [o.orderId, o])).values())
    for (const item of order.items) {
      const row = products.get(item.itemId) ?? {
        itemId: item.itemId,
        name: item.name,
        ordersContaining: 0,
        observedOccurrences: 0,
        lastOrderedAt: null,
        url: urls.product(item.itemId),
        typicalQuantity: null,
      };
      row.ordersContaining++;
      row.observedOccurrences += item.occurrences;
      if (dateKey(order.createdAt) > dateKey(row.lastOrderedAt))
        row.lastOrderedAt = order.createdAt;
      products.set(item.itemId, row);
    }
  return [...products.values()].sort(
    (a, b) =>
      b.ordersContaining - a.ordersContaining ||
      b.observedOccurrences - a.observedOccurrences,
  );
}
async function memoryPath(): Promise<string> {
  const session = await sessionInfo();
  if (!session.loggedIn || !session.userId)
    throw new Error(
      "Sign in with start_login before reading shopping memory. Nothing was ordered.",
    );
  const account = createHash("sha256")
    .update(session.userId)
    .digest("hex")
    .slice(0, 24);
  return join(config.dataDir, "memory", `${account}.json`);
}
async function read(path: string): Promise<ShoppingMemory> {
  try {
    const data = JSON.parse(await readFile(path, "utf8"));
    if (
      data.version !== 1 ||
      !Array.isArray(data.orders) ||
      !Array.isArray(data.preferences)
    )
      throw new Error("Unrecognised shopping memory format.");
    return data;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      return { version: 1, refreshedAt: null, orders: [], preferences: [] };
    throw e;
  }
}
async function write(path: string, data: ShoppingMemory) {
  await mkdir(join(config.dataDir, "memory"), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(data), { mode: 0o600 });
  await rename(tmp, path);
}
export async function shoppingMemory(refresh = false, query?: string) {
  const path = await memoryPath();
  const memory = await read(path);
  if (refresh) {
    memory.orders = mergeOrders(
      memory.orders,
      normaliseOrders(await apiGet(urls.recentOrders(), urls.home())),
    );
    memory.refreshedAt = new Date().toISOString();
    await write(path, memory);
  }
  const products = summariseHistory(memory.orders).filter(
    (p) => !query || p.name.toLowerCase().includes(query.toLowerCase()),
  );
  return {
    version: memory.version,
    refreshedAt: memory.refreshedAt,
    preferences: memory.preferences.filter(
      (p) => !query || p.label.includes(query.toLowerCase()),
    ),
    products: products.slice(0, 100),
    availableProductCount: products.length,
    observedOrderCount: memory.orders.length,
    coverage:
      "Only orders exposed by the recent-orders API plus previously observed orders. Repeated item rows are occurrences, not verified unit quantities. This is not lifetime history.",
    nextStep:
      "Use frequency to suggest familiar products. Ask for quantity and any unresolved quality, brand, or pack-size preference; history is not purchase approval.",
  };
}
export async function rememberProduct(args: {
  label: string;
  url: string;
  quality?: string;
  quantity?: number;
}) {
  const path = await memoryPath();
  const memory = await read(path);
  const label = args.label.trim().toLowerCase();
  const preference: Preference = {
    label,
    url: validateLazadaUrl(args.url, "product"),
    quality: args.quality ?? null,
    quantity: args.quantity ?? null,
    updatedAt: new Date().toISOString(),
  };
  memory.preferences = [
    ...memory.preferences.filter((p) => p.label !== label),
    preference,
  ].slice(-200);
  await write(path, memory);
  return {
    remembered: preference,
    message:
      "Saved for suggestions across tasks. It does not authorize future cart changes or orders.",
  };
}
export async function forgetMemory(label?: string) {
  const path = await memoryPath();
  const memory = await read(path);
  if (label)
    memory.preferences = memory.preferences.filter(
      (p) => p.label !== label.trim().toLowerCase(),
    );
  else {
    memory.orders = [];
    memory.preferences = [];
    memory.refreshedAt = null;
  }
  await write(path, memory);
  return {
    forgotten: true,
    scope: label ?? "all shopping memory for this account",
  };
}
