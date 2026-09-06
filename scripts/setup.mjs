#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const sourceRoot = fileURLToPath(new URL("../", import.meta.url));
// Fixed allowlist: a checkout can also contain the owner's private diagnostics and other worktrees.
const shipped = [
  "package.json",
  "manifest.json",
  "npm-shrinkwrap.json",
  "tsconfig.json",
  "dist",
  "src",
  "scripts",
  "skills",
  "test",
  "docs",
  ".codex-plugin",
  ".claude-plugin",
  ".github/ISSUE_TEMPLATE",
  ".mcp.json",
  "README.md",
  "SETUP.md",
  "AGENTS.md",
  "CONTRIBUTING.md",
  "LICENSE",
];
async function exists(path) {
  return access(path).then(
    () => true,
    () => false,
  );
}
export function run(command, args, cwd) {
  return new Promise((yes, no) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", process.stderr, process.stderr],
      shell: false,
    });
    child.on("error", (error) =>
      no(
        new Error(
          error.code === "ENOENT"
            ? `${command} is not installed or not on PATH. Ask your assistant to install it, then run setup again.`
            : error.message,
        ),
      ),
    );
    child.on("exit", (code) =>
      code === 0
        ? yes()
        : no(
            new Error(
              `${command} did not finish successfully (exit ${code}). Setup can be run again; your saved login is unchanged.`,
            ),
          ),
    );
  });
}
async function sourceFiles(root) {
  const files = [];
  async function walk(relative) {
    const { lstat } = await import("node:fs/promises");
    const path = join(root, relative);
    const stat = await lstat(path);
    if (stat.isSymbolicLink())
      throw new Error(
        `Setup refuses a symlink in package content: ${relative}`,
      );
    if (stat.isDirectory()) {
      for (const name of (await readdir(path)).sort())
        await walk(join(relative, name));
    } else if (stat.isFile()) files.push(relative);
  }
  for (const name of shipped)
    if (await exists(join(root, name))) await walk(name);
  return files;
}
export async function installRuntime({
  root = sourceRoot,
  installRoot = process.env.LAZADA_SETUP_ROOT ?? join(homedir(), ".lazada-mcp", "apps"),
  execute = run,
} = {}) {
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  if (pkg.name !== "lazada-mcp" || !/^\d+\.\d+\.\d+$/.test(pkg.version))
    throw new Error("Invalid Lazada package metadata.");
  const files = await sourceFiles(root);
  const hash = createHash("sha256");
  for (const file of files)
    hash.update(file).update(await readFile(join(root, file)));
  const destination = join(
    resolve(installRoot),
    `${pkg.version}-${hash.digest("hex").slice(0, 16)}`,
  );
  if (await exists(join(destination, ".setup-complete"))) return destination;
  await mkdir(resolve(installRoot), { recursive: true, mode: 0o700 });
  const staging = await mkdtemp(join(resolve(installRoot), ".install-"));
  try {
    for (const file of files) {
      await mkdir(dirname(join(staging, file)), {
        recursive: true,
        mode: 0o700,
      });
      await cp(join(root, file), join(staging, file));
    }
    console.error(
      "Preparing Lazada. This only takes a moment on the first install…",
    );
    await execute(
      "npm",
      ["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
      staging,
    );
    // Releases already contain compiled code; clean Git clones are built automatically here.
    if (!(await exists(join(staging, "dist/index.js"))))
      await execute("npm", ["run", "build"], staging);
    if (!(await exists(join(staging, "dist/index.js"))))
      throw new Error("Lazada's runtime is missing. Setup did not complete.");
    await writeFile(join(staging, ".setup-complete"), pkg.version, {
      mode: 0o600,
    });
    try {
      await rename(staging, destination);
    } catch (error) {
      // A concurrent installer may have finished the identical package first.
      if (!(await exists(join(destination, ".setup-complete")))) throw error;
    }
    return destination;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
/** Install discovery instructions as well as tools; a bare MCP registration is easy to miss. */
export async function installCodexSkill(root, { skillsRoot = join(homedir(), ".agents", "skills") } = {}) {
  const source = await readFile(join(root, "skills/lazada-shopping/SKILL.md"), "utf8");
  const destination = join(skillsRoot, "lazada-shopping");
  const skillPath = join(destination, "SKILL.md");
  const markerPath = join(destination, ".lazada-managed");
  const digest = value => createHash("sha256").update(value).digest("hex");
  if (await exists(destination)) {
    const previous = await readFile(skillPath, "utf8").catch(() => null);
    if (previous === source) return destination;
    const marker = await readFile(markerPath, "utf8").catch(() => null);
    if (previous === null || marker !== digest(previous))
      throw new Error(`Shopping tools are installed, but setup preserved an existing/customized skill at ${destination}. Ask your assistant to review it before updating the shopping instructions.`);
  }
  await mkdir(destination, { recursive: true, mode: 0o700 });
  await writeFile(skillPath, source, { mode: 0o600 });
  await writeFile(markerPath, digest(source), { mode: 0o600 });
  return destination;
}

export function clientRegistration(client, root) {
  const entry = join(root, "scripts", "launch-mcp.mjs");
  if (client === "codex")
    return {
      command: "codex",
      args: ["mcp", "add", "lazada", "--", process.execPath, entry],
    };
  if (client === "claude")
    return {
      command: "claude",
      args: [
        "mcp",
        "add",
        "--scope",
        "user",
        "lazada",
        "--",
        process.execPath,
        entry,
      ],
    };
  throw new Error("Choose codex, claude, or config.");
}
export async function setup(args, options = {}) {
  const [client, ...extra] = args;
  if (!["codex", "claude", "config"].includes(client) || extra.length)
    throw new Error("Usage: lazada-mcp setup codex|claude|config");
  if (Number(process.versions.node.split(".")[0]) < 22)
    throw new Error(
      "Lazada needs Node.js 22 or newer. Ask your assistant to install the current Node.js LTS, then retry.",
    );
  if (process.platform === "win32")
    throw new Error(
      "This version supports macOS and Linux. Windows support is still under development.",
    );
  const root = await installRuntime(options);
  const config = {
    mcpServers: {
      lazada: {
        command: process.execPath,
        args: [join(root, "scripts", "launch-mcp.mjs")],
      },
    },
  };
  if (client === "config") console.log(JSON.stringify(config, null, 2));
  else {
    const registration = clientRegistration(client, root);
    await (options.execute ?? run)(
      registration.command,
      registration.args,
      root,
    );
    if (client === "codex") await installCodexSkill(root, options);
    console.error(
      `Lazada is connected to ${client === "codex" ? "Codex" : "Claude Code"}. Open a new task and say “Connect Lazada”. Complete sign-in in the visible browser. Chrome must be installed.`,
    );
  }
  console.error(`Shared Lazada data: ${process.env.LAZADA_DATA_DIR ?? join(homedir(), ".lazada-mcp")}. Local clients using this same directory share login and account preferences; their own chat memories remain separate.`);
  return { root, config };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await setup(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
