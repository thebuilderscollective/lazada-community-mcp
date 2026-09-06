import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { daemonExecutable } from "../dist/runtime.js";

test("Electron hosts use the packaged runtime and never fall back to the GUI helper", async () => {
  const root = await mkdtemp("/tmp/lazada-runtime-");
  const runtime = { electron: true, execPath: "/Claude Helper", platform: "darwin", arch: "arm64", root };
  try {
    assert.throws(() => daemonExecutable(runtime), /Reinstall the latest Lazada Desktop bundle/);
    const directory = join(root, "runtime/darwin-arm64");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "node"), "fixture", { mode: 0o755 });
    assert.equal(daemonExecutable(runtime), join(directory, "node"));
    assert.equal(daemonExecutable({ ...runtime, electron: false, execPath: "/standalone/node" }), "/standalone/node");
    assert.throws(() => daemonExecutable({ ...runtime, arch: "x64" }), /missing its standalone Node runtime/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
