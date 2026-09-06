import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("stdio handshake exposes portable, richly-described tools without opening a browser", async () => {
  const root = resolve(new URL("..", import.meta.url).pathname);
  const dataDir = await mkdtemp(join(tmpdir(), "lazada-protocol-"));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve(root, "scripts/launch-mcp.mjs")],
    cwd: "/tmp",
    stderr: "pipe",
    env: { ...process.env, LAZADA_DATA_DIR: dataDir },
  });
  const client = new Client({ name: "lazada-mcp-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    const identity = client.getServerVersion();
    assert.deepEqual(
      { name: identity.name, version: identity.version },
      {
        name: "lazada-mcp",
        version: "1.1.0",
      },
    );
    assert.equal(identity.icons[0].mimeType, "image/svg+xml");
    const icon = identity.icons[0].src;
    assert.match(icon, /^data:image\/svg\+xml;base64,/);
    assert.equal(
      Buffer.from(icon.split(",")[1], "base64").toString(),
      await readFile(resolve(root, "docs/assets/logo.svg"), "utf8"),
    );
    const listed = await client.listTools();
    assert.equal(listed.tools.length, 25);
    assert.equal(
      listed.tools.some((tool) => tool.name === "submit_otp"),
      false,
    );
    for (const tool of listed.tools) {
      assert.ok(tool.title, tool.name);
      assert.ok(tool.inputSchema, tool.name);
      assert.ok(tool.outputSchema, tool.name);
      assert.equal(typeof tool.annotations?.readOnlyHint, "boolean", tool.name);
      assert.equal(tool.annotations?.openWorldHint, true, tool.name);
    }
    const place = listed.tools.find((tool) => tool.name === "place_order");
    assert.equal(place.annotations.destructiveHint, true);
    assert.equal(place._meta["anthropic/requiresUserInteraction"], true);
    assert.ok(place.inputSchema.properties.review_token);
    const resources = await client.listResources();
    const picker = resources.resources.find(
      (r) => r.mimeType === "text/html;profile=mcp-app",
    );
    assert.ok(
      picker,
      "Clients must be able to discover the picker by its HTML media type",
    );
    const content = await client.readResource({ uri: picker.uri });
    assert.ok(
      content.contents.some(
        (r) => r.mimeType === picker.mimeType && r.text?.includes("<html"),
      ),
    );
  } finally {
    await client.close().catch(() => {});
    const info = JSON.parse(
      await readFile(join(dataDir, "service.json"), "utf8").catch(() => "null"),
    );
    if (info) process.kill(info.pid, "SIGTERM");
    await new Promise((r) => setTimeout(r, 300));
    await rm(dataDir, { recursive: true, force: true });
  }
});
