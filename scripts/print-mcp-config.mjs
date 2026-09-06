#!/usr/bin/env node
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const serverPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));
if (!existsSync(serverPath)) {
  console.error("Build output is missing. Run `npm run build` first.");
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      mcpServers: {
        lazada: {
          command: process.execPath,
          args: [serverPath],
          env: {
            LAZADA_BASE_URL: "https://www.lazada.sg",
            LAZADA_MAX_ORDER_TOTAL: "300",
          },
        },
      },
    },
    null,
    2,
  ),
);
