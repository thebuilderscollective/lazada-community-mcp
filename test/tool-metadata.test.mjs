import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  SERVER_INFO,
  TOOL_SPECS,
  getToolSpec,
  successResult,
} from "../dist/server.js";

test("server identity comes from package metadata", async () => {
  const pkg = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(
    { name: SERVER_INFO.name, version: SERVER_INFO.version },
    { name: pkg.name, version: pkg.version },
  );
  assert.match(SERVER_INFO.icons[0].src, /^data:image\/svg\+xml;base64,/);
});

test("every tool has a title, output schema, and complete behavior hints", () => {
  assert.equal(TOOL_SPECS.length, 25);
  assert.equal(
    TOOL_SPECS.some((tool) => tool.name === "submit_otp"),
    false,
  );
  assert.equal(
    new Set(TOOL_SPECS.map((tool) => tool.name)).size,
    TOOL_SPECS.length,
  );
  for (const tool of TOOL_SPECS) {
    assert.ok(tool.title, tool.name);
    assert.ok(tool.outputSchema, tool.name);
    assert.equal(tool.annotations.title, tool.title, tool.name);
    for (const hint of [
      "readOnlyHint",
      "destructiveHint",
      "idempotentHint",
      "openWorldHint",
    ]) {
      assert.equal(
        typeof tool.annotations[hint],
        "boolean",
        `${tool.name}.${hint}`,
      );
    }
    assert.equal(tool.annotations.openWorldHint, true, tool.name);
  }
});

test("safety-sensitive metadata is conservative and interaction-aware", () => {
  assert.deepEqual(getToolSpec("get_cart").annotations, {
    title: "Get Lazada Cart",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  });
  assert.equal(
    getToolSpec("remove_from_cart").annotations.destructiveHint,
    true,
  );
  assert.equal(getToolSpec("place_order").annotations.destructiveHint, true);
  assert.equal(getToolSpec("place_order").annotations.idempotentHint, false);
  assert.deepEqual(getToolSpec("place_order")._meta, {
    "anthropic/requiresUserInteraction": true,
  });
});

test("tool input schemas enforce order confirmation and URL policy", async () => {
  const place = getToolSpec("place_order").inputSchema;
  assert.equal(
    place.safeParse({
      confirm: false,
      expected_total: 9.09,
      review_token: "x".repeat(32),
    }).success,
    false,
  );
  assert.equal(
    place.safeParse({ confirm: true, expected_total: 9.09 }).success,
    false,
  );
  assert.equal(
    place.safeParse({
      confirm: true,
      expected_total: 9.09,
      review_token: "x".repeat(32),
    }).success,
    true,
  );

  const product = getToolSpec("get_product").inputSchema;
  assert.equal(
    (
      await product.parseAsync({
        url: "https://www.lazada.sg/products/milk-i123.html#x",
      })
    ).url,
    "https://www.lazada.sg/products/milk-i123.html",
  );
  await assert.rejects(() =>
    product.parseAsync({ url: "https://127.0.0.1/products/milk-i123.html" }),
  );

  const selection = getToolSpec("select_cart_items").inputSchema;
  assert.equal(selection.safeParse({ all: false }).success, false);
  assert.equal(selection.safeParse({ item_names: [] }).success, false);
  await assert.rejects(
    () => getToolSpec("select_cart_items").handler({ all: true, none: true }),
    /exactly one/,
  );
});

test("successful results provide structured content and a JSON text fallback", () => {
  const result = successResult({ count: 2, values: ["a", "b"] });
  assert.deepEqual(result.structuredContent, { count: 2, values: ["a", "b"] });
  assert.deepEqual(
    JSON.parse(result.content[0].text),
    result.structuredContent,
  );
});

test("plugin package uses relative launch paths and aligned versions", async () => {
  const pkg = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const manifest = JSON.parse(
    await readFile(
      new URL("../.codex-plugin/plugin.json", import.meta.url),
      "utf8",
    ),
  );
  const mcp = JSON.parse(
    await readFile(new URL("../.mcp.json", import.meta.url), "utf8"),
  );
  assert.equal(manifest.version.split("+")[0], pkg.version);
  assert.equal(manifest.mcpServers, "./.mcp.json");
  assert.equal(mcp.mcpServers.lazada.command, "node");
  assert.deepEqual(mcp.mcpServers.lazada.args, ["scripts/launch-mcp.mjs"]);
  assert.equal(
    mcp.mcpServers.lazada.args.some((part) => part.startsWith("/")),
    false,
  );
});
