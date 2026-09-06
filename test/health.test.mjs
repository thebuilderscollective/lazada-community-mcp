import assert from "node:assert/strict";
import test from "node:test";
import {
  publicLiveReport,
  parseTestSummary,
  renderHealth,
} from "../scripts/health.mjs";
test("public health export excludes private payloads and refuses incomplete green reports", () => {
  const report = publicLiveReport({
    passed: true,
    ordered: false,
    completedAt: "2026-09-06T00:00:00Z",
    secret: "private-cookie",
    checks: [
      { name: "connection", status: "passed", address: "private-address" },
      { name: "private-title", status: "passed" },
    ],
  });
  assert.equal(report.status, "failed");
  assert.equal(JSON.stringify(report).includes("private"), false);
  assert.equal(report.total, 12);
  const duplicate = publicLiveReport({
    passed: true,
    ordered: false,
    completedAt: "2026-09-06T00:00:00Z",
    checks: [
      { name: "connection", status: "passed" },
      { name: "connection", status: "passed" },
    ],
  });
  assert.equal(duplicate.passed, 0);
  assert.equal(duplicate.checks.length, 1);
});
test("test summary keeps skipped tests distinct and rejects missing evidence", () => {
  assert.deepEqual(
    parseTestSummary("# tests 3\n# pass 2\n# fail 0\n# skipped 1\n"),
    { total: 3, passed: 2, failed: 0, skipped: 1 },
  );
  assert.throws(() => parseTestSummary("looks good"));
});
test("shared test successes do not upgrade unverified client status", () => {
  const markdown = renderHealth({
    automated: {
      status: "passed",
      passed: 2,
      total: 3,
      skipped: 1,
      checkedAt: "2026-09-06T00:00:00Z",
    },
    clients: [
      {
        name: "Grok",
        status: "blocked",
        scope: "Awaiting human sign-in",
        checkedAt: null,
      },
    ],
  });
  assert.match(markdown, /2\/3 passed; 1 skipped/);
  assert.match(markdown, /Grok.*Blocked/);
  assert.match(markdown, /older than seven days/);
});
