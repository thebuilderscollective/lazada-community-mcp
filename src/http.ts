#!/usr/bin/env node
import { createServer } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { SERVER_INFO, SERVER_INSTRUCTIONS } from "./server.js";

/** Optional authenticated gateway. It forwards to the same local service as stdio. */
export async function startHttpGateway(opts: {
  token: string;
  port: number;
  host?: string;
  allowedOrigins?: string[];
}) {
  if (opts.token.length < 32)
    throw new Error("HTTP bearer token must have at least 32 characters.");
  const entries = new Map<
    string,
    {
      transport: StreamableHTTPServerTransport;
      client: Client;
      server: Server;
      touched: number;
    }
  >();
  const host = opts.host ?? "127.0.0.1";
  const http = createServer(async (req, res) => {
    let pendingClient: Client | undefined;
    let pendingServer: Server | undefined;
    try {
      if (req.url !== "/mcp") {
        res.writeHead(404).end();
        return;
      }
      const provided = Buffer.from(req.headers.authorization ?? "");
      const expected = Buffer.from(`Bearer ${opts.token}`);
      if (
        provided.length !== expected.length ||
        !timingSafeEqual(provided, expected)
      ) {
        res.writeHead(401, { "WWW-Authenticate": "Bearer" }).end();
        return;
      }
      if (
        req.headers.origin &&
        !opts.allowedOrigins?.includes(req.headers.origin)
      ) {
        res.writeHead(403).end();
        return;
      }
      if (req.headers["mcp-session-id"]) {
        const entry = entries.get(String(req.headers["mcp-session-id"]));
        if (!entry) {
          res.writeHead(404).end();
          return;
        }
        entry.touched = Date.now();
        await entry.transport.handleRequest(req, res);
        return;
      }
      if (req.method !== "POST") {
        res.writeHead(405).end();
        return;
      }
      if (entries.size >= 32) {
        res.writeHead(429).end();
        return;
      }
      const client = new Client({
        name: "lazada-http-bridge",
        version: SERVER_INFO.version,
      });
      pendingClient = client;
      await client.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: [fileURLToPath(new URL("./index.js", import.meta.url))],
          stderr: "ignore",
          env: Object.fromEntries(
            Object.entries(process.env).filter(
              (entry): entry is [string, string] => entry[1] !== undefined,
            ),
          ),
        }),
      );
      const server = new Server(SERVER_INFO, {
        instructions: SERVER_INSTRUCTIONS,
        capabilities: { tools: {}, resources: {} },
      });
      pendingServer = server;
      server.setRequestHandler(ListToolsRequestSchema, () =>
        client.listTools(),
      );
      server.setRequestHandler(CallToolRequestSchema, (request) =>
        client.callTool(request.params),
      );
      server.setRequestHandler(ListResourcesRequestSchema, () =>
        client.listResources(),
      );
      server.setRequestHandler(ReadResourceRequestSchema, (request) =>
        client.readResource(request.params),
      );
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: randomUUID,
        enableJsonResponse: true,
      });
      await server.connect(transport);
      await transport.handleRequest(req, res);
      if (transport.sessionId) {
        const id = transport.sessionId;
        entries.set(id, { transport, client, server, touched: Date.now() });
        pendingClient = undefined;
        pendingServer = undefined;
        const prior = transport.onclose;
        transport.onclose = () => {
          prior?.();
          entries.delete(id);
          void client.close();
        };
      } else {
        await server.close();
        await client.close();
      }
    } catch {
      await pendingServer?.close().catch(() => {});
      await pendingClient?.close().catch(() => {});
      if (!res.headersSent)
        res
          .writeHead(500)
          .end("MCP gateway request failed. No automatic retry was attempted.");
      else res.end();
    }
  });
  const timer = setInterval(() => {
    for (const [id, entry] of entries)
      if (Date.now() - entry.touched > 30 * 60_000) {
        entries.delete(id);
        void entry.server.close();
        void entry.client.close();
      }
  }, 60_000).unref();
  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(opts.port, host, resolve);
  });
  return {
    http,
    close: async () => {
      clearInterval(timer);
      for (const entry of entries.values()) {
        await entry.server.close();
        await entry.client.close();
      }
      http.closeAllConnections();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = process.env.LAZADA_HTTP_TOKEN_FILE;
  if (!path)
    throw new Error(
      "Set LAZADA_HTTP_TOKEN_FILE to a private token file before starting HTTP.",
    );
  const port = Number(process.env.LAZADA_HTTP_PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid LAZADA_HTTP_PORT.");
  const gateway = await startHttpGateway({
    token: (await readFile(path, "utf8")).trim(),
    port,
    host: process.env.LAZADA_HTTP_HOST,
    allowedOrigins: process.env.LAZADA_HTTP_ALLOWED_ORIGINS?.split(","),
  });
  console.error(`Lazada authenticated HTTP gateway listening on port ${port}.`);
  process.once("SIGTERM", () => void gateway.close());
  process.once("SIGINT", () => void gateway.close());
}
