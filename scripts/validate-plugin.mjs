#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";

const manifestUrl = new URL("../.codex-plugin/plugin.json", import.meta.url);
const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));

for (const [label, value] of [
  ["name", manifest.name],
  ["version", manifest.version],
  ["description", manifest.description],
  ["author.name", manifest.author?.name],
  ["interface.displayName", manifest.interface?.displayName],
  ["interface.shortDescription", manifest.interface?.shortDescription],
  ["interface.longDescription", manifest.interface?.longDescription],
  ["interface.developerName", manifest.interface?.developerName],
  ["interface.category", manifest.interface?.category],
]) {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`Missing plugin field: ${label}`);
}
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.name))
  throw new Error("Plugin name must be kebab-case.");
if (
  !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
    manifest.version,
  )
) {
  throw new Error("Plugin version must be strict semver.");
}
for (const field of ["skills", "mcpServers"]) {
  const relative = manifest[field];
  if (typeof relative !== "string" || !relative.startsWith("./")) {
    throw new Error(
      `${field} must be a plugin-relative path beginning with ./`,
    );
  }
  await access(new URL(`../${relative.slice(2)}`, manifestUrl));
}
const prompts = manifest.interface?.defaultPrompt ?? [];
if (
  !Array.isArray(prompts) ||
  prompts.length > 3 ||
  prompts.some((prompt) => typeof prompt !== "string" || prompt.length > 128)
) {
  throw new Error(
    "interface.defaultPrompt must contain at most three strings of at most 128 characters.",
  );
}
if (JSON.stringify(manifest).includes("[TODO:"))
  throw new Error("Plugin manifest contains a TODO placeholder.");

console.log(`Valid plugin: ${manifest.name}@${manifest.version}`);

// All distribution formats must describe the same release and carry its license.
const root = new URL('../', import.meta.url);
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
for (const name of ['.codex-plugin/plugin.json', '.claude-plugin/plugin.json', 'manifest.json']) {
  const entry = JSON.parse(await readFile(new URL(name, root), 'utf8'));
  if (entry.version !== pkg.version || entry.license !== pkg.license)
    throw new Error(`${name} version/license must match package.json`);
}
const lock = JSON.parse(await readFile(new URL('npm-shrinkwrap.json', root), 'utf8'));
if (lock.version !== pkg.version || lock.packages[''].version !== pkg.version || lock.packages[''].license !== pkg.license)
  throw new Error('Shrinkwrap root version/license must match package.json');
if (pkg.license !== 'MIT' || !(await readFile(new URL('LICENSE', root), 'utf8')).startsWith('MIT License'))
  throw new Error('The community release must include its MIT license');
