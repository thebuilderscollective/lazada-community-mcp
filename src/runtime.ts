import { accessSync, constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/** Electron utility hosts cannot safely relaunch process.execPath as Node. */
export function daemonExecutable(
  runtime = {
    electron: !!process.versions.electron,
    execPath: process.execPath,
    platform: process.platform as string,
    arch: process.arch as string,
    root: fileURLToPath(new URL("../", import.meta.url)),
  },
): string {
  if (!runtime.electron) return runtime.execPath;
  const executable = join(runtime.root, "runtime", `${runtime.platform}-${runtime.arch}`, "node");
  try {
    accessSync(executable, constants.X_OK);
  } catch {
    throw new Error(
      "This Desktop bundle is missing its standalone Node runtime. Reinstall the latest Lazada Desktop bundle, then restart the connection. Nothing was ordered.",
    );
  }
  return executable;
}
