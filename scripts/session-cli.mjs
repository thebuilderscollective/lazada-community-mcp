#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
const client = new Client({ name: "lazada-session-cli", version: "1.1.0" });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../dist/index.js", import.meta.url))],
    stderr: "inherit",
    env: process.env,
  }),
);
try {
  const tool =
    process.argv[2] === "probe"
      ? "probe_page"
      : process.argv[2] === "capture"
        ? "capture_session"
        : process.argv[2] === "status"
          ? "session_status"
          : "start_login";
  const result = await client.callTool({
    name: tool,
    arguments: tool === "probe_page" ? { url: process.argv[3] } : {},
  });
  console.log(result.structuredContent ?? result);
  if (result.isError) process.exitCode = 1;
} finally {
  await client.close();
}
