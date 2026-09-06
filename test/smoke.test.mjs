import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer, getToolSpec } from "../dist/server.js";
import { searchResultFromPayload } from "../dist/redmart.js";
import { createShortlist, addShortlistToCart } from "../dist/shortlist.js";
import { productPickerHtml } from "../dist/product-picker-ui.js";
import {
  analyseDeals,
  inferPackInfo,
  calculateUnitPrice,
} from "../dist/products.js";
import {
  normaliseOrders,
  mergeOrders,
  summariseHistory,
} from "../dist/memory.js";
import { lazadaState, decodeApiBody } from "../dist/session.js";
const fixture = JSON.parse(
  await readFile(
    new URL("./fixtures/search-products.json", import.meta.url),
    "utf8",
  ),
);

test("product comparisons preserve pack size, unit prices, and honest counts", () => {
  assert.equal(inferPackInfo("Organic Oat Milk Drink 1L - Case"), null);
  assert.equal(
    calculateUnitPrice(
      23.46,
      inferPackInfo("Organic Oat Milk Drink 1L - Case"),
    ),
    null,
  );
  const result = searchResultFromPayload(fixture, "milk", 1, 2);
  assert.equal(result.count, 2);
  assert.equal(result.availableOnPage, 2);
  assert.equal(result.totalAvailable, null);
  assert.equal(result.storefrontTotalAvailable, 42);
  assert.deepEqual(result.results[0].unitPrice, {
    value: 3.6,
    currency: "SGD",
    per: "l",
  });
  assert.equal(
    searchResultFromPayload(
      { mods: { listItems: [] }, mainInfo: { totalResults: 0 } },
      "absent",
      1,
      3,
    ).count,
    0,
  );
  assert.equal(searchResultFromPayload({ broken: true }, "milk", 1, 3), null);
  assert.equal(calculateUnitPrice(6, inferPackInfo("2 x 500ml")).value, 6);
  assert.equal(calculateUnitPrice(6, inferPackInfo("500ml x 2")).value, 6);
  assert.equal(calculateUnitPrice(Infinity, inferPackInfo("1L")), null);
});
test("missing quantity stays unknown and direct add requires explicit quantity", async () => {
  const shortlist = await createShortlist([{ query: "milk" }], {}, async (q) =>
    searchResultFromPayload(fixture, q, 1, 3),
  );
  assert.equal(shortlist.groups[0].quantity, null);
  assert.equal(shortlist.groups[0].quantityRequired, true);
  assert.equal(shortlist.groups[0].questions.length, 2);
  assert.equal(
    getToolSpec("add_to_cart").inputSchema.safeParse({
      url: "https://www.lazada.sg/products/pdp-i123.html",
    }).success,
    false,
  );
  await assert.rejects(
    () =>
      addShortlistToCart({
        shortlistId: shortlist.shortlistId,
        selections: [
          {
            groupId: "item-1",
            url: shortlist.groups[0].candidates[0].url,
            quantity: 0,
          },
        ],
        confirm: true,
      }),
    /explicit quantity/,
  );
});
test("repeated history refresh never doubles frequency or invents quantities", () => {
  const raw = {
    module: [
      {
        tradeOrderId: "1",
        createdAt: "28/08/2026",
        items: [
          { itemId: "1", title: "Milk" },
          { itemId: "1", title: "Milk" },
        ],
      },
      {
        tradeOrderId: "2",
        createdAt: "31/05/2026",
        items: [{ itemId: "1", title: "Milk" }],
      },
    ],
  };
  const normal = normaliseOrders(raw);
  const merged = mergeOrders(normal, normal);
  assert.equal(merged.length, 2);
  const row = summariseHistory(merged)[0];
  assert.equal(row.ordersContaining, 2);
  assert.equal(row.observedOccurrences, 3);
  assert.equal(row.typicalQuantity, null);
  assert.equal(row.lastOrderedAt, "28/08/2026");
  assert.throws(
    () => normaliseOrders({ module: [{ tradeOrderId: "1" }] }),
    /identifier or items/,
  );
});
test("multi-buy savings are explicit estimates requiring approval", () => {
  const deal = analyseDeals(["Buy 2 for $6", "10% off"], 4);
  assert.equal(deal.length, 1);
  assert.equal(deal[0].estimatedSavings, 2);
  assert.equal(deal[0].requiresApproval, true);
  assert.equal(analyseDeals(["Buy 2 save more"], 4)[0].bundlePrice, null);
});
test("session filtering rejects unrelated domains and keeps values out of API errors", () => {
  const cookie = (domain) => ({
    name: "s",
    value: "secret",
    domain,
    path: "/",
    expires: -1,
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
  });
  assert.equal(
    lazadaState({
      cookies: [
        cookie(".lazada.sg"),
        cookie("evil-lazada.sg"),
        cookie("lazada.sg.evil.test"),
      ],
    }).cookies.length,
    1,
  );
  assert.deepEqual(decodeApiBody("{&quot;success&quot;:true}"), {
    success: true,
  });
  assert.throws(
    () => decodeApiBody("<html>secret</html>"),
    (e) => !e.message.includes("secret"),
  );
});
test("tools serialize across independent MCP sessions", async () => {
  let running = 0,
    max = 0;
  const override = {
    session_status: async () => {
      running++;
      max = Math.max(max, running);
      await new Promise((r) => setTimeout(r, 20));
      running--;
      return { ok: true };
    },
  };
  const clients = [];
  for (let i = 0; i < 2; i++) {
    const server = createMcpServer(override),
      client = new Client({ name: "test", version: "1" });
    const [c, s] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(c), server.connect(s)]);
    clients.push(client);
  }
  try {
    await Promise.all(
      clients.map((c) => c.callTool({ name: "session_status", arguments: {} })),
    );
    assert.equal(max, 1);
  } finally {
    await Promise.all(clients.map((c) => c.close()));
  }
});
test("picker script parses, initializes MCP Apps, and leaves quantity blank", () => {
  const script = /<script>([\s\S]*?)<\/script>/.exec(productPickerHtml)[1];
  assert.doesNotThrow(() => new Function(script));
  assert.match(script, /ui\/initialize/);
  assert.match(script, /group.quantity == null \? ''/);
});
