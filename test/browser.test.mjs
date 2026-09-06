import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { once } from "node:events";
const executable = process.env.LAZADA_TEST_CHROME;
test(
  "host CDP uses one dedicated tab, captures privately, and leaves host Chrome running",
  { skip: !executable },
  async () => {
    const dir = await mkdtemp("/tmp/lazada-cdp-");
    const chrome = spawn(
      executable,
      [
        "--headless=new",
        "--disable-background-networking",
        "--no-first-run",
        "--remote-debugging-port=0",
        `--user-data-dir=${join(dir, "chrome")}`,
        "about:blank",
      ],
      { stdio: "ignore" },
    );
    let runner;
    try {
      let port;
      for (let i = 0; i < 80; i++) {
        const file = await readFile(
          join(dir, "chrome", "DevToolsActivePort"),
          "utf8",
        ).catch(() => null);
        if (file) {
          port = Number(file.split("\n")[0]);
          break;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      assert(port, "Chrome did not expose a debugging endpoint");
      const endpoint = `http://127.0.0.1:${port}`;
      const before = await fetch(endpoint + "/json/list").then((r) => r.json());
      const script = `import {getContext,withPage,closeBrowser,browserStatus} from ${JSON.stringify(new URL("../dist/browser.js", import.meta.url).href)}; const ctx=await getContext(); await ctx.addCookies([{name:'fixture',value:'not-a-real-session',domain:'.lazada.sg',path:'/'}]); await withPage(p=>p.setContent('<h1>Isolated host-browser fixture</h1>')); console.log(JSON.stringify(browserStatus())); await closeBrowser();`;
      runner = spawn(process.execPath, ["--input-type=module", "-e", script], {
        env: {
          ...process.env,
          LAZADA_DATA_DIR: join(dir, "service"),
          LAZADA_LOGIN_MODE: "host",
          LAZADA_CDP_URL: endpoint,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "",
        stderr = "";
      runner.stdout.on("data", (c) => (stdout += c));
      runner.stderr.on("data", (c) => (stderr += c));
      const [code] = await once(runner, "exit");
      assert.equal(code, 0, stderr);
      assert.equal(JSON.parse(stdout).externallyOwned, true);
      const after = await fetch(endpoint + "/json/list").then((r) => r.json());
      assert.deepEqual(
        after
          .filter((t) => t.type === "page")
          .map((t) => t.id)
          .sort(),
        before
          .filter((t) => t.type === "page")
          .map((t) => t.id)
          .sort(),
      );
      assert.equal(chrome.exitCode, null);
      const state = JSON.parse(
        await readFile(join(dir, "service", "storageState.json"), "utf8"),
      );
      assert.equal(state.cookies.length, 1);
    } finally {
      runner?.kill();
      chrome.kill();
      await once(chrome, "exit").catch(() => {});
      await rm(dir, { recursive: true, force: true });
    }
  },
);
