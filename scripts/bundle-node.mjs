import { createHash } from "node:crypto";
import { mkdir, writeFile, copyFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// Pin both architectures and hashes from Node's official SHASUMS256.txt.
// Download only at package time; installation never executes a network bootstrap.
const version = "22.23.2";
const checksums = {
  arm64: "61130f394c1630d211dd50aecc4353d379480f36d3ac913cd85dbba1aed585c6",
  x64: "58e99022c2ff89395576cc7fd4d98cea24bb68081475d5f88b801ee8729fb026",
};
export async function bundleNode(stage, temporary) {
  for (const [arch, expected] of Object.entries(checksums)) {
    const name = `node-v${version}-darwin-${arch}`;
    const response = await fetch(`https://nodejs.org/dist/v${version}/${name}.tar.gz`);
    if (!response.ok) throw new Error(`Node runtime download failed: ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== expected)
      throw new Error(`Node ${arch} checksum mismatch; refusing to package.`);
    const archive = join(temporary, `${name}.tar.gz`);
    await writeFile(archive, bytes);
    const extracted = spawnSync("tar", ["-xzf", archive, "-C", temporary, `${name}/bin/node`, `${name}/LICENSE`]);
    if (extracted.error || extracted.status !== 0) throw new Error("Could not extract verified Node runtime.");
    const destination = join(stage, "runtime", `darwin-${arch}`);
    await mkdir(destination, { recursive: true });
    await copyFile(join(temporary, name, "bin/node"), join(destination, "node"));
    await chmod(join(destination, "node"), 0o755);
    await copyFile(join(temporary, name, "LICENSE"), join(destination, "LICENSE"));
  }
}
