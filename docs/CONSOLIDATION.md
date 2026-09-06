# Consolidation record

Target: `codex/consolidaiton`. Source worktrees are preserved.

| Source | Useful work retained | Resolution |
|---|---|---|
| `codex/lazada-plugin-portability` at `ab5ed0b` | Plugin packaging, product normalization, pack/unit-price comparisons, shortlists, optional MCP Apps picker | Fast-forwarded into target, then integrated with the safety architecture. Missing quantities no longer default to 1; shortlists are consumed on add. |
| Detached worktree `1b87` on `06162db`, uncommitted | Separate server factory, rich tool metadata, URL policy, one-use checkout fingerprints, guarded tests, portable launcher | Copied relevant source and tests without modifying or committing the donor worktree. Kept the stricter S$0–0.50 tolerance policy. |
| `feat/onboarding` / `grok-share` at `83f82ea` | Browser-independent requests, persisted sessions, installed-browser fallback concepts | Reimplemented with a domain-aware Playwright cookie jar. Did not retain raw cookie-header input through MCP, broadly matched domains, or chat OTP handling. |
| `worktree-grok-eng-brief` at `c6a982c` | Non-blocking start/capture login and explicit host mode | Consolidated into one login flow. Host mode attaches to a configured visible browser; it does not claim a returned URL automatically transfers login. |

## Architecture

Default deployment: independent sessions per computer, shared across tasks on that computer. Codex and
Claude Code on the Mac share login and memory; Grok uses its own shared cloud computer's login and memory.
Cross-machine cookie synchronization is optional external infrastructure, not a prerequisite or bundled flow.

The stdio entrypoint is a thin client of a single private Unix-socket service per data directory.
The service owns the browser and has one operation queue across all connected MCP sessions. Individual
clients can disconnect without closing the shared browser. A configuration/version signature detects
incompatible clients; an intentional service restart activates upgrades without erasing login.

The HTTP gateway forwards to that service using the same protocol and tool metadata. A cloud route and
compatible authentication must be provisioned separately. Service sockets currently target macOS/Linux;
Windows named-pipe support has not been implemented or claimed.

Shopping memory deduplicates observed orders by ID and products by item ID within each order. It retains
only grocery identities, titles, dates, counts, and user-saved preferences, not addresses/payment details.
Repeated order rows are not assumed to be quantities. Unknown quantity stays null in comparisons and
is required on cart mutations. Deals are conservative estimates with explicit approval advice.

## Verification

- Isolated unit/protocol tests cover exact checkout fingerprints, expiry/reuse, strict total/tolerance
  guards, URL restrictions, malformed responses, quantity requirements, history deduplication, deals,
  global handler serialization, simultaneous process startup, shared service reuse, and HTTP bearer/Origin checks.
- Plugin manifests validated with the official Codex plugin validator and local validation script.
- Live checks and installed-client results are recorded below as they complete.
- Never tested the final order click. Delivery slot interaction remains inherited and requires a focused
  live check before claiming full end-to-end checkout coverage.

## Host limitations

Grok Bot's visible shared desktop was reachable through the app. After the owner authorized coordination,
Chief of Staff copied the release archive to the VM and reported discovering its visible Chrome's actual
debugging endpoint. Installation and human sign-in still require a completed verification report;
the app showed an out-of-usage notice during this rollout. A follow-up contains the corrected archive
instructions. Host-mode code and protocol tests are not represented as a verified Grok-native sign-in.

ChatGPT Work cloud similarly needs reachable hosted tools; the existing local Codex plugin alone does
not establish a cloud connection. The authenticated gateway is available for that deployment, but there
is no public endpoint or OAuth server implicitly provisioned by this consolidation.

## Verified on the live account and installed clients

- Two independent MCP clients reported the same service PID and both reused the existing signed-in session.
- `start_login` returned already signed in without another login window.
- Before/after full cart-line identity, quantity, and selected-state snapshots matched in that verification run. No cart mutation or order was performed.
- History refresh deduplicated observed orders and repeated rows, with quantity correctly left unknown.
- An oat-milk shortlist returned 3 candidates and both missing-quantity and quality questions. Live product details included a current promotion; no multi-buy deal was fabricated from a spend-threshold gift offer.
- Codex personal plugin updated to 2.0.0 with a cachebuster and reinstalled. New tasks pick up the new skills/tools.
- Claude Code registration added at user scope; `claude mcp get lazada` reports Connected both inside and outside the repo. Its plugin manifest also validates.
- Grok Marketplace → Your plugins → lazada reports a manually added command `node /workspace/lazada-mcp/dist/index.js`, exposing 17 tools. This is an old VM installation, separate from the 25-tool consolidated Mac server. It has not yet been replaced.

## Final checks

- `npm test`: 24 passed, 0 failed; 2 opt-in tests skipped in the isolated default run.
- Opt-in host-browser test run separately against a disposable installed Chrome profile: passed. It verifies a dedicated tab, private captured state, and host browser survival after disconnection.
- Concurrent crash recovery is tested with three clients reconnecting after a disposable service is stopped forcibly.
- Install archive uses a file allowlist. It contains runtime/source/skills/manifests/docs, with no working cart snapshots, sessions, profile, local memory, or dependencies copied from this computer.
- Extracted release archive clean-installed with `npm ci` and passed the same 24 isolated tests. `npm-shrinkwrap.json` pins dependencies inside the archive; synthetic tests are included.

## Follow-up: setup and ongoing verification

- README now begins with Codex / ChatGPT, Claude, then Grok (testing), followed by capabilities.
- `npm run test:live` now drives the real MCP service through a bounded set of browser checks, compares
  full cart snapshots in cleanup, and saves a private counts/status report. Coverage and attended-only
  checks are explicit in `docs/TESTING.md`.
- A real Claude Code prompt successfully called `session_status`, `whoami`, and `shortlist_products`,
  reused the signed-in service, compared oat milk, and asked for missing quantity and quality.
  No cart changes or orders were requested or made. User-scope connection also passed outside this repo.
- This exercise exposed an ambiguous “1L - Case” listing. The parser now withholds unit prices when
  a case/bundle count is unknown. A regression fixture covers it.
- Live address diagnosis followed the site's actual navigation from the stale my-host shell to
  `member.lazada.sg/address`; the page's own request exposes the saved addresses.
- The picker resource now advertises its HTML media type in `resources/list`, covered by the real
  stdio protocol test. Actual picker rendering remains client-specific and needs attended verification.
- Final follow-up validation: 30 isolated tests passed, 0 failed, 1 optional disposable-browser test
  skipped in the default run. All 12 live checks passed; the final full cart snapshots matched
  (identities, quantities, and selected state). No cart mutation or order was performed.

## Earlier archive setup (historical)

- The package's `lazada-mcp` executable now supports `setup codex`, `setup claude`, and `setup config`.
  Setup installs a stable private copy and uses the client's official MCP CLI; fresh clones build automatically.
- Releases are built by `npm pack` before shipping. Friends can use
  `npx --yes ./lazada-mcp-2.0.0.tgz setup codex` without manual dependency/build commands.
- A real npx installation from a clean temporary folder passed. After removing its download and npm cache,
  the generated configuration still completed an MCP handshake and exposed all 25 tools.
- The isolated suite passed 32 tests with 0 failures and 1 optional browser test skipped. Installer fixtures
  verify copying only shipped files, reuse, clone building, failure cleanup, and registration arguments.
- At that stage no package was published to npm and no Git remote had been created. A short registry-based install name remains
  a release/distribution step; the downloadable archive is usable now.
