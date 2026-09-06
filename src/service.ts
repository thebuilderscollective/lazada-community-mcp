import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { createConnection, createServer, type Socket } from "node:net";
import {
  chmod,
  mkdir,
  open,
  readFile,
  unlink,
  writeFile,
  rename,
} from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { config } from "./config.js";
import { createMcpServer } from "./server.js";
import { closeBrowser } from "./browser.js";
import { SERVER_INFO } from "./version.js";

export const socketPath = join(config.dataDir, "service.sock");
const lockPath = join(config.dataDir, "service.lock");
const buildDir = fileURLToPath(new URL("./", import.meta.url));
const buildHash = createHash("sha256");
for (const file of readdirSync(buildDir)
  .filter((f) => f.endsWith(".js"))
  .sort())
  buildHash.update(file).update(readFileSync(join(buildDir, file)));
const signature = createHash("sha256")
  .update(
    JSON.stringify({
      config,
      version: SERVER_INFO.version,
      build: buildHash.digest("hex"),
    }),
  )
  .digest("hex");
const infoPath = join(config.dataDir, "service.json");
export function connectService(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    socket.once("connect", () => {
      socket.removeListener("error", reject);
      socket.on("error", () => {});
      resolve(socket);
    });
    socket.once("error", reject);
  });
}
export async function ensureService(): Promise<Socket> {
  await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
  await chmod(config.dataDir, 0o700);
  const checkedConnection = async () => {
    const socket = await connectService();
    const info = JSON.parse(
      await readFile(infoPath, "utf8").catch(() => "null"),
    );
    if (!info) {
      socket.destroy();
      throw Object.assign(new Error("Service starting"), {
        code: "ECONNREFUSED",
      });
    }
    if (info.signature !== signature) {
      socket.destroy();
      throw new Error(
        "The running Lazada service uses a different version or configuration. Run npm run doctor, then npm run service:stop when tasks are idle and reconnect. Saved login is preserved. Nothing was ordered.",
      );
    }
    return socket;
  };
  try {
    return await checkedConnection();
  } catch (e) {
    if (
      !["ENOENT", "ECONNREFUSED"].includes(
        (e as NodeJS.ErrnoException).code ?? "",
      )
    )
      throw e;
  }
  const log = await open(join(config.dataDir, "service.log"), "a", 0o600);
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("./daemon.js", import.meta.url))],
    {
      detached: true,
      stdio: ["ignore", log.fd, log.fd],
      env: process.env,
    },
  );
  child.on("error", () => {});
  child.unref();
  await log.close();
  for (let i = 0; i < 60; i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    try {
      return await checkedConnection();
    } catch (e) {
      if (
        !["ENOENT", "ECONNREFUSED"].includes(
          (e as NodeJS.ErrnoException).code ?? "",
        )
      )
        throw e;
    }
  }
  throw new Error(
    `Shared Lazada service did not start. Inspect ${join(config.dataDir, "service.log")}. Nothing was ordered.`,
  );
}
/** One owner across all MCP clients, plugin caches, and worktrees using this data directory. */
export async function runService(): Promise<void> {
  await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
  await chmod(config.dataDir, 0o700);
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    // Serialize stale-owner recovery so concurrent newcomers cannot remove a
    // replacement lock that another newcomer has just acquired.
    const recoveryPath = join(config.dataDir, "service.recovery");
    const recovery = await open(recoveryPath, "wx", 0o600).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return null;
      throw error;
    });
    if (!recovery) return;
    try {
      const pid = Number(await readFile(lockPath, "utf8").catch(() => ""));
      // An empty lock can be between open and write. Never steal it.
      if (!Number.isSafeInteger(pid) || pid <= 0) return;
      try {
        process.kill(pid, 0);
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") return;
      }
      await unlink(lockPath);
      try {
        lock = await open(lockPath, "wx", 0o600);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") return;
        throw error;
      }
    } finally {
      await recovery.close();
      await unlink(recoveryPath).catch(() => {});
    }
  }
  await lock.writeFile(String(process.pid));
  await lock.close();
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    const mcp = createMcpServer();
    const transport = new StdioServerTransport(socket, socket);
    socket.on("error", () => socket.destroy());
    socket.on("close", () => {
      sockets.delete(socket);
      void mcp.close();
    });
    void mcp.connect(transport).catch(() => socket.destroy());
  });
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const socket of sockets) socket.destroy();
    server.close();
    await closeBrowser();
    await unlink(socketPath).catch(() => {});
    await unlink(lockPath).catch(() => {});
    await unlink(infoPath).catch(() => {});
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
  await unlink(socketPath).catch(() => {});
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  await chmod(socketPath, 0o600);
  await writeFile(
    `${infoPath}.${process.pid}.tmp`,
    JSON.stringify({
      pid: process.pid,
      signature,
      version: SERVER_INFO.version,
      source: fileURLToPath(new URL("../", import.meta.url)),
      profileDir: config.profileDir,
      loginMode: config.loginMode,
      cdpConfigured: !!config.cdpUrl,
    }),
    { mode: 0o600 },
  );
  await rename(`${infoPath}.${process.pid}.tmp`, infoPath);
  console.error(
    `Lazada shared service ${SERVER_INFO.version} ready; login mode ${config.loginMode}.`,
  );
}
