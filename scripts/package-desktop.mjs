#!/usr/bin/env node
import { mkdtemp, cp, rm, readFile, readdir, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
const root = fileURLToPath(new URL("../", import.meta.url));
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
if (manifest.version !== pkg.version)
  throw new Error("Desktop manifest version must match package.json before packaging.");
const destination = resolve(
  process.argv[2] ?? `lazada-mcp-${pkg.version}.mcpb`,
);
const stage = await mkdtemp(join(tmpdir(), "lazada-desktop-package-"));
const run = (command, args, cwd) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", shell: false });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)),
    );
  });
try {
  await run("npm", ["run", "build"], root);
  // Only project-owned release files plus freshly resolved production dependencies.
  for (const path of [
    "manifest.json",
    "package.json",
    "npm-shrinkwrap.json",
    "dist",
    "scripts",
    "docs",
    "skills",
    "README.md",
    "SETUP.md",
    "AGENTS.md",
    "CONTRIBUTING.md",
  "LICENSE",
  ])
    await cp(join(root, path), join(stage, path), { recursive: true });
  await run(
    "npm",
    ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
    stage,
  );
  // No install-time compiler or browser download. Remove npm command shims; runtime uses imports.
  await rm(join(stage, "node_modules/.bin"), { recursive: true, force: true });
  async function check(dir) {
    for (const name of await readdir(dir)) {
      const path = join(dir, name),
        s = await lstat(path);
      if (s.isSymbolicLink())
        throw new Error(`Unexpected symlink in bundle: ${name}`);
      if (s.isDirectory()) await check(path);
    }
  }
  await check(stage);
  await run(
    "npx",
    ["--yes", "@anthropic-ai/mcpb@2.1.2", "pack", stage, destination],
    root,
  );
  console.log(`Desktop bundle: ${destination}`);
} finally {
  await rm(stage, { recursive: true, force: true });
}
