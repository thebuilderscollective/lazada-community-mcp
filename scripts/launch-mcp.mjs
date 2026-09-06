#!/usr/bin/env node
import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entrypoint = resolve(pluginRoot, "dist/index.js");

try {
  await access(entrypoint);
} catch {
  console.error(
    `Lazada setup is incomplete. Ask your assistant to run \`node scripts/setup.mjs config\` in ${pluginRoot} and use the resulting connection configuration.`,
  );
  process.exit(1);
}

// Keep generated diagnostics and relative configuration rooted in the plugin,
// even when a client launches this file from another working directory.
process.chdir(pluginRoot);
const { main } = await import(pathToFileURL(entrypoint).href);
await main();
