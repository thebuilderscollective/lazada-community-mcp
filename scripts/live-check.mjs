#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export function cartSnapshot(cart) {
  assert.ok(Array.isArray(cart.lines), "Cart lines missing");
  assert.equal(
    cart.lineCount,
    cart.lines.length,
    "Cart pagination/count mismatch",
  );
  assert.equal(
    new Set(cart.lines.map((l) => l.cartItemId)).size,
    cart.lines.length,
    "Duplicate cart lines",
  );
  return cart.lines
    .map((l) => {
      assert.ok(l.cartItemId, "Cart line identity missing");
      assert.ok(
        (Number.isFinite(l.quantity) && l.quantity > 0) ||
          (l.quantity === null && l.available === false && !l.selected),
        "Available/selected cart line quantity missing",
      );
      assert.equal(typeof l.selected, "boolean", "Cart selection missing");
      return [l.cartItemId, l.quantity, l.selected, l.available];
    })
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
}

/** Bounded live reads through the real service. Results retain counts, not account data. */
export async function runLiveChecks(connect, { query = "oat milk" } = {}) {
  const report = {
    startedAt: new Date().toISOString(),
    passed: false,
    ordered: false,
    checks: [],
  };
  const clients = [];
  let before;
  async function check(name, fn) {
    const start = Date.now();
    try {
      const detail = await fn();
      report.checks.push({
        name,
        status: "passed",
        durationMs: Date.now() - start,
        ...detail,
      });
      return true;
    } catch (error) {
      // Tool payloads can contain account data. Keep reports deliberately terse.
      report.checks.push({
        name,
        status: "failed",
        durationMs: Date.now() - start,
        reason:
          error instanceof assert.AssertionError
            ? error.message.split("\n")[0]
            : "Tool or transport failed; inspect this capability interactively.",
      });
      return false;
    }
  }
  const call = async (name, args = {}, client = clients[0]) => {
    const result = await client.callTool({ name, arguments: args }, undefined, {
      timeout: 120_000,
    });
    if (result.isError) throw new Error(`Tool failed: ${name}`);
    const data = result.structuredContent;
    assert.ok(
      data && typeof data === "object",
      `${name}: structured result missing`,
    );
    return data;
  };
  try {
    if (
      !(await check("connection", async () => {
        clients.push(await connect());
        clients.push(await connect());
        const [a, b] = await Promise.all(
          clients.map((c) => call("session_status", {}, c)),
        );
        assert.equal(
          a.servicePid,
          b.servicePid,
          "Clients do not share one service",
        );
        assert.equal(a.sharedAcrossTasks, true);
        const listed = await clients[0].listTools();
        assert.equal(
          listed.tools.length,
          25,
          "Unexpected tool inventory; update coverage matrix",
        );
        return {
          version: a.version,
          toolCount: listed.tools.length,
          sharedService: true,
        };
      }))
    )
      return report;
    if (
      !(await check("signed_in", async () => {
        assert.equal(
          (await call("whoami")).loggedIn,
          true,
          "Session expired: finish human sign-in before running live checks",
        );
      }))
    )
      return report;
    if (
      !(await check("cart_before", async () => {
        const cart = await call("get_cart");
        before = cartSnapshot(cart);
        return { lines: cart.lineCount, selected: cart.selectedCount };
      }))
    )
      return report;
    await check("login_reuse", async () => {
      const login = await call("start_login", {}, clients[1]);
      assert.equal(login.loggedIn, true);
      assert.equal(login.started, false, "Unexpected new login window");
      assert.equal((await call("capture_session")).loggedIn, true);
    });
    let productUrl;
    await check("search", async () => {
      const search = await call("search_products", { query, limit: 3 });
      assert.ok(
        search.results?.length > 0,
        "Known grocery query returned no products",
      );
      assert.equal(search.count, search.results.length);
      productUrl = search.results[0].url;
      return { candidates: search.results.length };
    });
    if (productUrl)
      await check("product", async () => {
        const product = await call("get_product", { url: productUrl });
        assert.ok(
          typeof product.title === "string" && product.title.trim(),
          "Product title unreadable",
        );
        assert.ok(
          Number.isFinite(product.price) && product.price > 0,
          "Product price unreadable",
        );
        assert.ok(Array.isArray(product.promotions), "Promotions missing");
        assert.ok(Array.isArray(product.deals), "Deal analysis missing");
      });
    await check("history", async () => {
      const orders = await call("list_orders", { limit: 3 });
      assert.ok(Array.isArray(orders.orders));
      assert.equal(orders.count, orders.orders.length);
      return { orders: orders.count };
    });
    await check("memory", async () => {
      const fresh = await call("get_shopping_memory", { refresh: true });
      const cached = await call("get_shopping_memory");
      assert.equal(fresh.observedOrderCount, cached.observedOrderCount);
      assert.deepEqual(fresh.products, cached.products);
      return {
        observedOrders: fresh.observedOrderCount,
        products: fresh.availableProductCount,
      };
    });
    await check("shortlist_and_picker", async () => {
      const shortlist = await call("shortlist_products", {
        items: [{ query }],
        limit_per_item: 2,
      });
      const group = shortlist.groups?.[0];
      assert.ok(
        group?.candidates.length > 0,
        "Shortlist returned no candidates",
      );
      assert.equal(group.quantity, null, "Missing quantity was guessed");
      assert.ok(
        group.questions.length >= 2,
        "Missing quantity/quality questions",
      );
      const picker = await call("render_product_picker", {
        shortlist_id: shortlist.shortlistId,
      });
      assert.equal(picker.shortlistId, shortlist.shortlistId);
      const resources = await clients[0].listResources();
      const uri = resources.resources.find((r) =>
        r.mimeType?.startsWith("text/html"),
      )?.uri;
      assert.ok(uri, "Picker resource not registered");
      const resource = await clients[0].readResource({ uri });
      assert.ok(
        resource.contents.some(
          (r) => typeof r.text === "string" && r.text.includes("<html"),
        ),
        "Picker HTML missing",
      );
      return { candidates: group.candidates.length };
    });
    await check("addresses", async () => {
      const result = await call("list_addresses");
      assert.ok(
        Array.isArray(result.addresses) && result.addresses.length > 0,
        "Saved addresses unreadable",
      );
      return { addresses: result.addresses.length };
    });
    await check("reconnect", async () => {
      const pid = (await call("session_status")).servicePid;
      await clients.pop().close();
      clients.push(await connect());
      assert.equal(
        (await call("session_status", {}, clients[1])).servicePid,
        pid,
      );
      assert.equal((await call("whoami", {}, clients[1])).loggedIn, true);
    });
  } finally {
    // Always compare after a mid-run failure; never overwrite concurrent user changes.
    if (before)
      await check("cart_unchanged", async () => {
        assert.deepEqual(
          cartSnapshot(await call("get_cart")),
          before,
          "Cart changed during checks; inspect concurrent shopping activity",
        );
      });
    await Promise.allSettled(clients.map((c) => c.close()));
    report.completedAt = new Date().toISOString();
    report.passed =
      report.checks.length > 0 &&
      report.checks.every((c) => c.status === "passed");
  }
  return report;
}

async function main() {
  const connect = async () => {
    const client = new Client({ name: "lazada-live-check", version: "1" });
    try {
      await client.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: [fileURLToPath(new URL("./launch-mcp.mjs", import.meta.url))],
          env: process.env,
          stderr: "inherit",
        }),
      );
      return client;
    } catch (e) {
      await client.close().catch(() => {});
      throw e;
    }
  };
  const report = await runLiveChecks(connect);
  const root = resolve(
    process.env.LAZADA_DATA_DIR ?? join(homedir(), ".lazada-mcp"),
  );
  const dir = join(root, "checks");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = join(dir, `latest.${process.pid}.tmp`);
  await writeFile(tmp, JSON.stringify(report, null, 2), { mode: 0o600 });
  await rename(tmp, join(dir, "latest.json"));
  console.log(JSON.stringify(report, null, 2));
  console.log(`Report: ${join(dir, "latest.json")}`);
  if (!report.passed) process.exitCode = 1;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch(() => {
    console.error(
      "Live check could not finish. Inspect the shared service and rerun while shopping tasks are idle.",
    );
    process.exitCode = 1;
  });
}
