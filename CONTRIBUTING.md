# Contributing to Lazada MCP

Thanks for helping make grocery shopping through an assistant less fiddly. You don't need to write
code to help: a clear bug report, confusing setup step, or carefully recorded client test is useful.

This is a community preview for personal use on Lazada Singapore. Use [GitHub issues](https://github.com/Rajat-Goyal/lazada-community-mcp/issues) for sanitized reports.
The project is [MIT licensed](LICENSE). Contributions are provided under the same license.

## A good first contribution

| You noticed… | A useful contribution |
|---|---|
| Setup asks you to do something unclear | Quote that step and suggest wording a nontechnical friend would understand |
| A product comparison looks wrong | Include the public product URL, expected pack size, and actual result |
| Login opened in the wrong place | Name the client, OS, browser, and whether the browser was visible |
| Something stopped working | Share the failing tool/check name and a small reproduction |
| A client flow works | Record exactly what you tested, when, which build, and what remains untested |

Start small. Follow the existing structured-page-data approach rather than adding another automation
framework. For a larger feature, discuss its intended user flow and scope with the maintainer first.

## Report a bug without sharing your account

Include the client/version, OS, plugin version (`session_status`), date/time with timezone, failing
capability, expected behavior, and a sanitized error. State whether the cart changed and whether it
was restored. A passing result is useful too, as long as its scope is clear.

Do **not** attach cookies, browser profiles, storage-state files, full order/cart dumps, addresses,
phone numbers, tokens, or unredacted screenshots. The raw `probe_page` output is private diagnostic
material. The generated `docs/health.json` summary is designed for public review; inspect every diff
before sharing it. Never post authentication material in a public issue.

## Develop locally

Use Node.js 22+ on macOS or Linux. Read [AGENTS.md](AGENTS.md) before changing shopping behavior.

```bash
npm ci
npm test
npm run validate:plugin
```

`npm test` uses synthetic fixtures and disposable services. It does not need a Lazada account.
One private service owns the real browser; new commands and diagnostics must go through that service.
Do not launch a second process against the same Chrome profile.

For the optional disposable-browser adapter test:

```bash
LAZADA_TEST_CHROME=/path/to/chrome npm run test:browser
```

## Verify a browser change

The live suite uses your own signed-in account. Run it only while other shopping tasks are idle:

```bash
npm run smoke -- --live
```

This runs the isolated suite, then bounded live reads, and updates the README's dated health snapshot.
It compares the complete cart before/after and exports only allowed status fields. It never places an
order. Login challenges need a human. An expired session is a failed check, not a reason to reset a profile.

For a parser/selector fix, inspect the actual failing page with one focused probe, add a synthetic
regression fixture, rerun the relevant checks, and record the verified finding in docs/MAINTENANCE.md.
Never guess a URL or reimplement Lazada's request signing.

Cart writes, delivery choices, and checkout need the separate attended procedure in
[docs/TESTING.md](docs/TESTING.md#controlled-cart-and-checkout-test). Snapshot and restore every changed
quantity and selection. **Never successfully call `place_order` as a test.**

## Record Codex, Claude, and Grok results honestly

The shared live checker verifies the MCP service, not every client UI. Use
[the client smoke procedure](docs/TESTING.md#client-smoke-reports) inside the actual client.
After reviewing evidence, update only that client's entry in `docs/health.json`, then run:

```bash
npm run health:refresh
```

Keep the run timestamp and scope precise. Use `partial` for connection-only checks, `blocked` for a
host/usage/sign-in blocker, and `untested` when there is no evidence. A read-only shopping prompt can
be `passed` with that limited scope; it does not establish working checkout or native picker rendering.
Do not turn Grok green because Codex or an SDK test passed.

## Prepare a change for review

- Explain the user-visible problem and the resulting behavior.
- Include relevant tests and the client/browser where you verified it.
- Identify remaining uncertainty and any cart restoration needed.
- Keep real account data out of code, fixtures, logs, and screenshots.
- For setup changes, test the archive through the exact documented `npx` command, including a path with spaces.

`npm pack` builds the release before packaging. Check that it contains the runtime, installer,
lockfile, documentation, and synthetic tests, with no session or diagnostic files. Follow the
existing Codex cachebuster/reinstall flow when changing an installed plugin. Publishing a package
or release remains an explicit maintainer action.
