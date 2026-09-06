import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
async function connect(env) {
  const client = new Client({ name: "integration", version: "1" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [entry],
      env,
      stderr: "pipe",
    }),
  );
  return client;
}
async function stop(dir) {
  const info = JSON.parse(
    await readFile(join(dir, "service.json"), "utf8").catch(() => "null"),
  );
  if (info) process.kill(info.pid, "SIGTERM");
  await new Promise((r) => setTimeout(r, 200));
}
test("simultaneous processes share service, signed-out check opens no browser, and disconnect preserves service", async () => {
  const dir = await mkdtemp("/tmp/lazada-shared-");
  const env = {
    ...process.env,
    LAZADA_DATA_DIR: dir,
    LAZADA_LOGIN_MODE: "host",
  };
  let clients = [];
  try {
    clients = await Promise.all([connect(env), connect(env), connect(env)]);
    const responses = await Promise.all(
      clients.map((c) => c.callTool({ name: "session_status", arguments: {} })),
    );
    assert.equal(
      new Set(responses.map((r) => r.structuredContent.servicePid)).size,
      1,
    );
    assert(responses.every((r) => r.structuredContent.connected === false));
    const login = await clients[0].callTool({
      name: "start_login",
      arguments: {},
    });
    assert.equal(login.structuredContent.status, "host_browser_required");
    const session = await clients[1].callTool({
      name: "whoami",
      arguments: {},
    });
    assert.equal(session.structuredContent.loggedIn, false);
    assert.equal(
      (await clients[0].callTool({ name: "session_status", arguments: {} }))
        .structuredContent.connected,
      false,
    );
    const pid = responses[0].structuredContent.servicePid;
    await Promise.all(clients.map((c) => c.close()));
    clients = [];
    const again = await connect(env);
    clients.push(again);
    assert.equal(
      (await again.callTool({ name: "session_status", arguments: {} }))
        .structuredContent.servicePid,
      pid,
    );
    await again.close();
    clients = [];
    process.kill(pid, "SIGKILL");
    await new Promise((resolve) => setTimeout(resolve, 150));
    clients = await Promise.all([connect(env), connect(env), connect(env)]);
    const restarted = await Promise.all(
      clients.map((c) => c.callTool({ name: "session_status", arguments: {} })),
    );
    assert.equal(
      new Set(restarted.map((r) => r.structuredContent.servicePid)).size,
      1,
    );
    assert.notEqual(restarted[0].structuredContent.servicePid, pid);
    const guard = await clients[0].callTool({
      name: "place_order",
      arguments: {
        confirm: true,
        expected_total: 1,
        review_token: "x".repeat(40),
      },
    });
    assert.equal(guard.isError, true);
    assert.match(guard.content[0].text, /invalid|review/i);
  } finally {
    await Promise.all(clients.map((c) => c.close()));
    await stop(dir);
    await rm(dir, { recursive: true, force: true });
  }
});
test("authenticated HTTP exposes same shared service and rejects unauthenticated or foreign-origin requests", async () => {
  const dir = await mkdtemp("/tmp/lazada-http-");
  const token = "test-only-token-".repeat(4),
    tokenPath = join(dir, "token");
  await writeFile(tokenPath, token, { mode: 0o600 });
  // Ask OS for a port in the child, report it over IPC; keep all data in disposable directory.
  const script = `import {startHttpGateway} from ${JSON.stringify(new URL("../dist/http.js", import.meta.url).href)}; const g=await startHttpGateway({token:${JSON.stringify(token)},port:0}); process.send(g.http.address().port); process.on('message',()=>g.close().then(()=>process.exit()));`;
  const env = {
    ...process.env,
    LAZADA_DATA_DIR: dir,
    LAZADA_LOGIN_MODE: "host",
  };
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
    env,
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  const port = await new Promise((resolve, reject) => {
    child.once("message", resolve);
    child.once("error", reject);
    child.once("exit", () => reject(new Error("gateway exited")));
  });
  const url = new URL(`http://127.0.0.1:${port}/mcp`);
  let client, local;
  try {
    assert.equal((await fetch(url)).status, 401);
    assert.equal(
      (
        await fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            Origin: "https://evil.test",
          },
        })
      ).status,
      403,
    );
    client = new Client({ name: "http-test", version: "1" });
    await client.connect(
      new StreamableHTTPClientTransport(url, {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    local = await connect(env);
    const httpStatus = await client.callTool({
        name: "session_status",
        arguments: {},
      }),
      stdioStatus = await local.callTool({
        name: "session_status",
        arguments: {},
      });
    assert.equal(
      httpStatus.structuredContent.servicePid,
      stdioStatus.structuredContent.servicePid,
    );
    assert.equal((await client.listTools()).tools.length, 25);
  } finally {
    await client?.close();
    await local?.close();
    child.send("stop");
    await new Promise((r) => child.once("exit", r));
    await stop(dir);
    await rm(dir, { recursive: true, force: true });
  }
});
