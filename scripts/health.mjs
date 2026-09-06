#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const liveNames = [
  "connection",
  "signed_in",
  "cart_before",
  "login_reuse",
  "search",
  "product",
  "history",
  "memory",
  "shortlist_and_picker",
  "addresses",
  "reconnect",
  "cart_unchanged",
];
export function publicLiveReport(raw) {
  if (
    !Number.isFinite(Date.parse(raw.completedAt)) ||
    !Array.isArray(raw.checks)
  )
    throw new Error("Invalid live report");
  // Deliberate allowlist: no cart/order counts, paths, titles, addresses, or failure payloads leave the host.
  const checks = liveNames.flatMap((name) => {
    const matches = raw.checks.filter((c) => c?.name === name);
    return matches.length
      ? [
          {
            name,
            status:
              matches.length === 1 && matches[0].status === "passed"
                ? "passed"
                : "failed",
          },
        ]
      : [];
  });
  const complete = liveNames.every((name) =>
    checks.some((c) => c.name === name && c.status === "passed"),
  );
  return {
    checkedAt: new Date(raw.completedAt).toISOString(),
    status:
      raw.passed === true && raw.ordered === false && complete
        ? "passed"
        : "failed",
    passed: checks.filter((c) => c.status === "passed").length,
    total: liveNames.length,
    checks,
  };
}
export function parseTestSummary(tap) {
  const value = (key) => {
    const matches = [
      ...tap.matchAll(new RegExp(`^# ${key} (\\d+)\\s*$`, "gm")),
    ];
    if (!matches.length)
      throw new Error(`Test runner omitted ${key}; refusing to report a pass`);
    return Number(matches.at(-1)[1]);
  };
  return {
    total: value("tests"),
    passed: value("pass"),
    failed: value("fail"),
    skipped: value("skipped"),
  };
}
const safe = (value) => String(value ?? "").replace(/[|<>\r\n]/g, " ");
const date = (value) =>
  value
    ? new Date(value).toISOString().slice(0, 16).replace("T", " ") + " UTC"
    : "Not run";
export function renderHealth(report) {
  const mark = (status) =>
    ({
      passed: "✅ Passed",
      partial: "🟡 Partial",
      blocked: "🟡 Blocked",
      failed: "🔴 Needs attention",
      untested: "⚪ Not verified",
    })[status] ?? "⚪ Not verified";
  const suite = report.automated;
  const live = report.live;
  const lines = [
    "| Check | Last reported result | Last checked |",
    "|---|---|---|",
    `| Isolated smoke suite | ${suite ? `${mark(suite.status)} · ${suite.passed}/${suite.total} passed; ${suite.skipped} skipped` : "Not run"} | ${date(suite?.checkedAt)} |`,
    `| Live Lazada browser reads | ${live ? `${mark(live.status)} · ${live.passed}/${live.total} checks` : "Not run"} | ${date(live?.checkedAt)} |`,
    ...report.clients.map(
      (c) =>
        `| ${safe(c.name)} | ${mark(c.status)} · ${safe(c.scope)} | ${date(c.checkedAt)} |`,
    ),
    "",
    "*Dated maintainer reports, not an uptime monitor or a guarantee for your account. A report older than seven days should be rechecked. Skipped tests are not passes.*",
    "",
    "[Machine-readable snapshot](docs/health.json) · [What is and isn't covered](docs/TESTING.md#capability-coverage)",
  ];
  return lines.join("\n");
}
async function execute(command, args) {
  return new Promise((yes, no) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    let stdout = "";
    child.stdout.on("data", (data) => {
      stdout += data;
      process.stderr.write(data);
    });
    child.stderr.on("data", (data) => process.stderr.write(data));
    child.on("error", no);
    child.on("exit", (code) => yes({ code, stdout }));
  });
}
async function main() {
  const args = process.argv.slice(2);
  if (
    args.some((a) => !["--live", "--refresh"].includes(a)) ||
    (args.includes("--live") && args.includes("--refresh"))
  )
    throw new Error(
      "Usage: npm run smoke [-- --live] or npm run health:refresh",
    );
  const file = join(root, "docs/health.json");
  const report = JSON.parse(await readFile(file, "utf8"));
  let failed = false;
  if (!args.includes("--refresh")) {
    const build = await execute("npm", ["run", "build"]);
    if (build.code !== 0) {
      report.automated = {
        checkedAt: new Date().toISOString(),
        status: "failed",
        total: 0,
        passed: 0,
        failed: 1,
        skipped: 0,
      };
      failed = true;
    } else {
      const tests = (await readdir(join(root, "test")))
        .filter((f) => f.endsWith(".test.mjs"))
        .sort()
        .map((f) => `test/${f}`);
      const run = await execute(process.execPath, [
        "--test",
        "--test-reporter=tap",
        ...tests,
      ]);
      const counts = parseTestSummary(run.stdout);
      failed = run.code !== 0 || counts.failed > 0 || counts.passed === 0;
      report.automated = {
        checkedAt: new Date().toISOString(),
        status: failed ? "failed" : "passed",
        ...counts,
      };
    }
    if (args.includes("--live") && !failed) {
      const started = Date.now();
      const run = await execute(process.execPath, ["scripts/live-check.mjs"]);
      try {
        const path = join(
          process.env.LAZADA_DATA_DIR ?? join(homedir(), ".lazada-mcp"),
          "checks/latest.json",
        );
        const raw = JSON.parse(await readFile(path, "utf8"));
        if (
          !Number.isFinite(Date.parse(raw.startedAt)) ||
          Date.parse(raw.startedAt) < started
        )
          throw new Error("Stale report");
        report.live = publicLiveReport(raw);
        if (run.code !== 0) report.live.status = "failed";
      } catch {
        report.live = {
          checkedAt: new Date().toISOString(),
          status: "failed",
          passed: 0,
          total: 12,
          checks: [],
        };
      }
      failed ||= report.live.status !== "passed";
    }
    // Per-client claims remain maintained evidence; a shared SDK test never promotes them.
    await writeFile(file, JSON.stringify(report, null, 2) + "\n");
  }
  const readme = join(root, "README.md");
  const text = await readFile(readme, "utf8");
  const block = /<!-- health:start -->[\s\S]*?<!-- health:end -->/;
  if (!block.test(text)) throw new Error("README health markers missing");
  await writeFile(
    readme,
    text.replace(
      block,
      `<!-- health:start -->\n${renderHealth(report)}\n<!-- health:end -->`,
    ),
  );
  console.log(
    "Updated the public health snapshot. Review the diff before sharing.",
  );
  if (failed) process.exitCode = 1;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
