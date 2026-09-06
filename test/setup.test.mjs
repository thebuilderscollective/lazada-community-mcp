import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
  access,
} from "node:fs/promises";
import { join } from "node:path";
import { installRuntime, clientRegistration } from "../scripts/setup.mjs";

async function fixture(compiled, body) {
  const base = await mkdtemp("/tmp/lazada-setup-");
  const root = join(base, "source with spaces");
  await mkdir(root);
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "lazada-mcp", version: "1.1.0" }),
  );
  await writeFile(join(root, "npm-shrinkwrap.json"), "{}");
  await mkdir(join(root, "debug"));
  await writeFile(join(root, "debug", "private.json"), "must not ship");
  if (compiled) {
    await mkdir(join(root, "dist"));
    await writeFile(
      join(root, "dist", "index.js"),
      "export const fixture=true;",
    );
  }
  try {
    await body({ root, installRoot: join(base, "installed apps") });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}
test("prebuilt setup installs dependencies once, survives removal of the download, and excludes private files", async () => {
  await fixture(true, async (options) => {
    const calls = [];
    const execute = async (command, args) => calls.push([command, ...args]);
    const installed = await installRuntime({ ...options, execute });
    assert.equal(await installRuntime({ ...options, execute }), installed);
    assert.deepEqual(calls, [
      ["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"],
    ]);
    await assert.rejects(access(join(installed, "debug")));
    await rm(options.root, { recursive: true });
    assert.match(
      await readFile(join(installed, "dist/index.js"), "utf8"),
      /fixture/,
    );
    assert.deepEqual(clientRegistration("codex", installed).args, [
      "mcp",
      "add",
      "lazada",
      "--",
      process.execPath,
      join(installed, "scripts/launch-mcp.mjs"),
    ]);
    assert.deepEqual(clientRegistration("claude", installed).args.slice(0, 6), [
      "mcp",
      "add",
      "--scope",
      "user",
      "lazada",
      "--",
    ]);
  });
});
test("fresh-clone setup builds automatically and failed preparation remains retryable", async () => {
  await fixture(false, async (options) => {
    await assert.rejects(
      installRuntime({
        ...options,
        execute: async () => {
          throw new Error("offline");
        },
      }),
      /offline/,
    );
    const calls = [];
    const installed = await installRuntime({
      ...options,
      execute: async (_, args, cwd) => {
        calls.push(args);
        if (args[0] === "run") {
          await mkdir(join(cwd, "dist"));
          await writeFile(join(cwd, "dist/index.js"), "compiled");
        }
      },
    });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1], ["run", "build"]);
    assert.equal(
      await readFile(join(installed, "dist/index.js"), "utf8"),
      "compiled",
    );
  });
});

test('Codex setup installs a discoverable skill, updates managed copies, and preserves user edits', async()=>{
 const {installCodexSkill}=await import('../scripts/setup.mjs');
 await fixture(true,async({root,installRoot})=>{
  const source=join(root,'skills/lazada-shopping');await mkdir(source,{recursive:true});
  await writeFile(join(source,'SKILL.md'),'first skill');
  const skillsRoot=join(installRoot,'user-skills');
  const target=await installCodexSkill(root,{skillsRoot});
  assert.equal(await readFile(join(target,'SKILL.md'),'utf8'),'first skill');
  await writeFile(join(source,'SKILL.md'),'updated skill');
  await installCodexSkill(root,{skillsRoot});
  assert.equal(await readFile(join(target,'SKILL.md'),'utf8'),'updated skill');
  await writeFile(join(target,'SKILL.md'),'my customization');
  await assert.rejects(installCodexSkill(root,{skillsRoot}),/preserved/);
  assert.equal(await readFile(join(target,'SKILL.md'),'utf8'),'my customization');
 });
});
