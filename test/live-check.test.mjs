import assert from "node:assert/strict";
import test from "node:test";
import { runLiveChecks, cartSnapshot } from "../scripts/live-check.mjs";

function fixture({
  signedIn = true,
  failProduct = false,
  changeCart = false,
  failSecondConnection = false,
} = {}) {
  let connects = 0,
    closed = 0,
    cartReads = 0;
  const called = [];
  const cart = {
    lineCount: 1,
    selectedCount: 0,
    lines: [{ cartItemId: "fixture", quantity: 2, selected: false }],
  };
  const group = {
    quantity: null,
    questions: ["quantity?", "quality?"],
    candidates: [{ url: "https://www.lazada.sg/products/pdp-i123.html" }],
  };
  return {
    called,
    get closed() {
      return closed;
    },
    connect: async () => {
      if (++connects === 2 && failSecondConnection)
        throw new Error("Connection failed");
      return {
        close: async () => {
          closed++;
        },
        listTools: async () => ({
          tools: Array.from({ length: 25 }, () => ({})),
        }),
        listResources: async () => ({
          resources: [{ uri: "ui://fixture", mimeType: "text/html" }],
        }),
        readResource: async () => ({
          contents: [{ text: "<html>fixture</html>" }],
        }),
        callTool: async ({ name }) => {
          called.push(name);
          let value;
          switch (name) {
            case "session_status":
              value = {
                servicePid: 123,
                version: "fixture",
                sharedAcrossTasks: true,
              };
              break;
            case "whoami":
              value = { loggedIn: signedIn };
              break;
            case "get_cart":
              value = structuredClone(cart);
              if (++cartReads > 1 && changeCart) value.lines[0].quantity++;
              break;
            case "start_login":
              value = { loggedIn: true, started: false };
              break;
            case "capture_session":
              value = { loggedIn: true };
              break;
            case "search_products":
              value = { count: 1, results: group.candidates };
              break;
            case "get_product":
              if (failProduct)
                return {
                  isError: true,
                  content: [{ text: "private response not for reports" }],
                };
              value = {
                title: "fixture milk",
                price: 3,
                promotions: [],
                deals: [],
              };
              break;
            case "list_orders":
              value = { count: 0, orders: [] };
              break;
            case "get_shopping_memory":
              value = {
                observedOrderCount: 0,
                availableProductCount: 0,
                products: [],
              };
              break;
            case "shortlist_products":
              value = { shortlistId: "fixture", groups: [group] };
              break;
            case "render_product_picker":
              value = { shortlistId: "fixture" };
              break;
            case "list_addresses":
              value = { addresses: [{ private: "not for reports" }] };
              break;
            default:
              throw new Error(`Unexpected capability: ${name}`);
          }
          return { structuredContent: value };
        },
      };
    },
  };
}
test("live checker covers bounded reads, reconnects, and keeps private payloads out of reports", async () => {
  const f = fixture();
  const report = await runLiveChecks(f.connect);
  assert.equal(report.passed, true);
  assert.equal(report.checks.length, 12);
  assert.equal(f.closed, 3);
  assert.equal(JSON.stringify(report).includes("not for reports"), false);
  assert.equal(
    f.called.some((n) =>
      /add_to|set_cart|select_|remove_|place_order|review_checkout/.test(n),
    ),
    false,
  );
});
test("expired login fails without opening login or reading the cart", async () => {
  const f = fixture({ signedIn: false });
  const report = await runLiveChecks(f.connect);
  assert.equal(report.passed, false);
  assert.equal(f.called.includes("start_login"), false);
  assert.equal(f.called.includes("get_cart"), false);
  assert.equal(f.closed, 2);
});
test("failed product check still verifies final cart and closes clients", async () => {
  const f = fixture({ failProduct: true });
  const report = await runLiveChecks(f.connect);
  assert.equal(report.passed, false);
  assert.equal(report.checks.at(-1).name, "cart_unchanged");
  assert.equal(report.checks.at(-1).status, "passed");
  assert.equal(JSON.stringify(report).includes("private response"), false);
  assert.equal(f.closed, 3);
});
test("a concurrent cart change is reported without trying to overwrite the user's change", async () => {
  const report = await runLiveChecks(fixture({ changeCart: true }).connect);
  assert.equal(report.passed, false);
  assert.equal(report.checks.at(-1).status, "failed");
});
test("partially connected checks close the first client if the second connection fails", async () => {
  const f = fixture({ failSecondConnection: true });
  assert.equal((await runLiveChecks(f.connect)).passed, false);
  assert.equal(f.closed, 1);
});
test("only unavailable unselected cart lines can have unknown quantities", () => {
  const cart = {
    lineCount: 1,
    lines: [
      { cartItemId: "gone", quantity: null, available: false, selected: false },
    ],
  };
  assert.equal(cartSnapshot(cart)[0][1], null);
  assert.throws(() =>
    cartSnapshot({ ...cart, lines: [{ ...cart.lines[0], available: true }] }),
  );
  assert.throws(() =>
    cartSnapshot({ ...cart, lines: [{ ...cart.lines[0], selected: true }] }),
  );
});
