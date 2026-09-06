#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { config } from "../dist/config.js";
import { connectService } from "../dist/service.js";
import { join } from "node:path";
const info = JSON.parse(
  await readFile(join(config.dataDir, "service.json"), "utf8").catch(
    () => "null",
  ),
);
if (!info) {
  console.log(
    "No shared service metadata found. Start an MCP client or npm run login.",
  );
} else if (process.argv[2] === "stop") {
  // Verify a responding service before using its recorded pid; never kill a stale, reused pid.
  const socket = await connectService();
  socket.write(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "service-control", version: "1.1.0" },
      },
    }) + "\n",
  );
  let buffer = "";
  const timer = setTimeout(() => {
    socket.destroy();
    console.error("Service did not respond; no process was stopped.");
    process.exitCode = 1;
  }, 5000);
  socket.on("data", (chunk) => {
    buffer += chunk;
    if (!buffer.includes("\n")) return;
    const response = JSON.parse(buffer.slice(0, buffer.indexOf("\n")));
    if (response.result?.serverInfo?.name === "lazada-mcp") {
      socket.write(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        }) + "\n",
      );
      socket.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "session_status", arguments: {} },
        }) + "\n",
      );
      buffer = buffer.slice(buffer.indexOf("\n") + 1);
      return;
    }
    const actual = response.result?.structuredContent?.servicePid;
    if (actual === info.pid) {
      process.kill(actual, "SIGTERM");
      console.log(
        "Stopped the shared Lazada service. Saved login is preserved. Reconnect all MCP clients; fully quit and reopen Claude Desktop. Existing client connections do not migrate automatically. Inspect cart/order state before retrying any interrupted shopping action.",
      );
    } else {
      console.error("Service PID did not match; no process was stopped.");
      process.exitCode = 1;
    }
    clearTimeout(timer);
    socket.destroy();
  });
} else
  console.log({
    ...info,
    note: "The service owns one browser. All tasks using this data directory share it. Restart after a code or browser configuration change.",
  });
