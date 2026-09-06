import { readFileSync } from "node:fs";

type PackageMetadata = { name: string; version: string };

function readPackageMetadata(): PackageMetadata {
  const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
  const parsed = JSON.parse(raw) as Partial<PackageMetadata>;
  if (!parsed.name || !parsed.version) {
    throw new Error("package.json must define name and version.");
  }
  return { name: parsed.name, version: parsed.version };
}

export const packageMetadata = Object.freeze(readPackageMetadata());
export const SERVER_INFO = Object.freeze({
  name: packageMetadata.name,
  version: packageMetadata.version,
  icons: [
    {
      src: `data:image/svg+xml;base64,${readFileSync(new URL("../docs/assets/logo.svg", import.meta.url)).toString("base64")}`,
      mimeType: "image/svg+xml",
      sizes: ["any"],
    },
  ],
});
