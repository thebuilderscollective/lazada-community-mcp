#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureService } from "./service.js";

/** Each harness gets its own MCP session over one shared browser owner. */
export async function main(): Promise<void> {
  const socket = await ensureService();
  process.stdin.pipe(socket);
  socket.pipe(process.stdout);
  const shutdown = () => {
    socket.destroy();
    process.stdin.pause();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  process.stdin.once("end", shutdown);
  socket.once("error", (error) => {
    console.error(error.message);
    shutdown();
    process.exitCode = 1;
  });
  socket.once("close", () => {
    process.stdin.unpipe(socket);
    process.stdin.pause();
  });
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
