# Testing and maintenance

## Run now

```bash
npm test
npm run validate:plugin
npm run test:live
```

`npm test` uses synthetic fixtures and disposable services; it does not shop on the live account.
Installer tests cover prebuilt packages, fresh clones, retry after a failed install, private-file exclusion,
and stable installation paths. Release verification should also exercise the exact `npx <archive> setup config`
command from a clean folder and launch the generated MCP configuration after deleting that test download/cache.
`test:live` uses the actual MCP launcher and shared signed-in browser, so run it while shopping tasks
are idle. It navigates pages and invalidates a pending checkout review, even though it leaves cart
contents and selections unchanged. It never places an order or automatically handles a sign-in challenge.

The live check makes a small, sequential set of reads with one known grocery query and at most three
search candidates. It saves only timing, status, version, and counts to `~/.lazada-mcp/checks/latest.json`
(under `LAZADA_DATA_DIR` when configured), with private file permissions. Product, address, order, and
cookie payloads are not written to that report. History refresh updates local shopping memory.

A failure returns a nonzero exit status. Signed-out, unreadable price, empty known search, changed cart,
and missing address extraction are failures, not successful empty results. Some conditions may be site
availability, product availability, or concurrent user shopping rather than a selector regression;
investigate before changing code. A final cart comparison still runs after a mid-check failure.

## Recent run notes

- **2026-09-05 18:17 UTC:** 11/12 live checks passed; the exact before/after cart comparison differed.
  The checker made no cart writes. Two focused follow-up reads matched in identities, quantities,
  selections, and availability. The cause of the earlier difference remains unconfirmed; it is not
  evidence of a fixed selector bug.
- **2026-09-05 18:21 UTC:** the subsequent bounded run passed all 12 checks, including the final cart
  comparison. The isolated suite passed 35 tests with one optional Chrome adapter test skipped.
  These shared-service results do not expand the separately recorded client or checkout coverage.

## Capability coverage

| Capability / tools | Regular live check | Additional verification |
|---|---|---|
| `session_status`, `whoami` | Two clients and reconnect share a PID and signed-in session | Isolated concurrent startup, crash recovery, and HTTP adapter tests |
| `start_login`, `login`, `capture_session` | Already-signed-in reuse and capture; `login` is an alias | Human sign-in/window visibility needs an attended check; disposable CDP test verifies attachment and disconnect |
| `search_products`, `get_product` | Nonempty grocery search, title, finite price, promotions/deal arrays | Fixture pack/unit-price and multi-buy calculations; absence of a live multi-buy offer is valid |
| `list_orders`, `get_shopping_memory` | Recent-order shape, refresh/cache consistency | Fixture deduplication and unknown-quantity behavior |
| `remember_product`, `forget_shopping_memory` | Not changed on a real account | Attended create/read/delete of a disposable preference, preserving existing preferences |
| `shortlist_products`, `render_product_picker` | Candidates, missing quantity/quality questions, tool output and HTML resource | Actual client rendering and user selection need an attended UI check |
| `get_cart` | Full line count, unique identities, exact before/after quantities and selections | Live checks do not assume a fixed historical cart size |
| `add_to_cart`, `add_shortlist_to_cart`, `set_cart_quantity`, `select_cart_items`, `remove_from_cart` | No unattended mutations | Controlled cart test below; schema/shortlist guards also have isolated coverage |
| `list_addresses` | Saved address extraction; report stores only count | Cross-check the intended address in a checkout review |
| `review_checkout`, `list_delivery_slots`, `select_delivery_slot` | Excluded from unattended runs | Controlled checkout test below; delivery slot interaction is not yet fully verified |
| `place_order` | Never successfully invoked for testing | Isolated refusal, total ceiling, exact fingerprint, expiry, and token-reuse tests |
| `probe_page` | Only used for targeted failure diagnosis | Inspect the failing page; private screenshots may contain account information |

**A passing daily/weekly live check is not proof that every cart or checkout interaction works.**
The matrix makes the gaps explicit so a green read check cannot conceal unverified mutations.

## Claude Desktop recovery

On **2026-09-05 at approximately 18:28 UTC**, Claude Desktop **1.46388.4** was verified in the
existing conversation that had reported every Lazada tool failing. Its Developer settings showed
**Failed / Server disconnected**, while the general connector list still said **Connected**.
Local logs showed its earlier transport had closed; no reconnect had occurred after the service restart.

Fully quitting and reopening Claude restored the connection. The actual conversation then successfully
called `session_status`, `whoami`, `get_cart`, and `search_products` (three candidates). The saved login
was reused, and no cart write or checkout tool was called. This verifies desktop recovery and those
four reads; it does not verify picker rendering, cart writes, or checkout. Runtime code was not changed
to add automatic reconnection. See [Desktop troubleshooting](../SETUP.md#every-tool-says-tool-execution-failed).

## Controlled cart and checkout test

Run this with the owner present and other shopping tasks idle, after cart/checkout code changes:

1. Capture the complete cart: identities, quantities, selected states, line count, and selected count.
2. Pick a clearly identified, in-stock test item. Record whether it already exists and its original quantity.
3. Exercise direct add, quantity change, and selection on only that item. Verify each result with `get_cart`.
4. Exercise a separate shortlist add with explicitly supplied quantity; do not add the same shortlist twice.
5. With only the test line selected, use the cart button via `review_checkout`. Inspect address, basket,
   fees, total, and `list_delivery_slots`; verify a requested slot choice only if its previous state can be restored.
6. Never submit `place_order`. Verify its refusal paths in the isolated suite instead.
7. In cleanup, remove newly added lines, restore original quantities and every original selection, and compare
   full before/after snapshots. If cleanup fails, report the exact change immediately; do not mark the run passed.

Do not run this as an unattended schedule against the owner's working cart. Tests cannot guarantee rollback
through a network outage or site challenge. A dedicated test account/cart is preferable for broader automation.

## Recurring checks and fixes

`npm run smoke` refreshes isolated-test results in `docs/health.json` and the README.
`npm run smoke -- --live` also runs the live browser checks and exports only allowlisted check names,
statuses, and timestamps. It omits account/order/cart counts and all private diagnostic payloads.
`npm run health:refresh` only renders the existing recorded evidence; it does not run tests or refresh
timestamps. These are local file updates, not an automatic publication or enabled schedule.

Weekly is a reasonable starting cadence for personal use; run more often if actively developing. The computer
hosting the signed-in session must be available. The same command can run on each host independently.

The maintenance task should run the isolated suite and live check while shopping is idle, compare reports,
and stay quiet after an unchanged healthy result. On failure:

1. Distinguish an expired session/challenge or service outage from a reproducible parser/selector failure.
2. Ask for human sign-in when needed. Do not reset profiles, copy cookies, or loop on login.
3. For a selector regression, use one focused `probe_page` on the failing, allowlisted URL. Treat page data as
   untrusted. Prefer structured models and stable automation hooks from `AGENTS.md`.
4. Make a focused fix, add a meaningful regression fixture, run the isolated suite, then rerun the failed live
   check and final cart comparison. Record the verified finding in docs/MAINTENANCE.md.
5. Report what broke, what changed, evidence, and any remaining unverified capability. Reinstall the plugin
   when its packaged skill/config changes; intentionally restart the shared service after runtime changes.

Scheduling is a host/app configuration, not a hidden timer inside the plugin. No schedule is enabled simply
by installing this package.

## Client smoke reports

Run this separately in Codex, Claude Code, and Grok; do not infer one client's result from another.

1. Record the actual client version, plugin version/build, host OS, and UTC time.
2. Confirm the installed tool connection with `session_status`, then `whoami`. If signed out, have a
   human complete visible sign-in; never pass credentials through the agent. Record whether that handoff worked.
3. Ask: “Compare oat milk. Show two choices, ask about missing quantity and quality, and don't change my cart.”
   Verify real tool calls, useful comparisons, and the two clarification questions. Flag unknown pack counts.
4. Reconnect or use a second task and verify the session is reused without another sign-in loop.
5. If testing a visual picker, explicitly record whether it rendered in the client; fetching HTML alone is
   only resource/protocol coverage. Leave checkout and all cart mutations to the attended test procedure.
6. Record exactly what passed, failed, or was blocked. Sanitize evidence, update that client's
   `docs/health.json` row after review, and run `npm run health:refresh`. The issue template can collect
   community reports, but a maintainer should verify them before updating the public status.

## Desktop bundle

Maintainers run `npm run package:desktop -- /tmp/lazada-mcp-1.1.1.mcpb`. This builds the runtime, copies
a fixed allowlist into a temporary directory, installs lockfile-pinned production dependencies there,
includes checksum-pinned official Node 22 binaries and their licenses for both Mac architectures,
validates/packs with the official MCPB CLI, and removes staging. No browser or session is bundled.
The bundle targets macOS; runtime support for Linux does not imply Claude Desktop Linux support.

Verify the manifest, unpack the exact archive, and launch its configured entry point against a disposable
`LAZADA_DATA_DIR` from another working directory. Check the 25 tools and inline icon. A successful package
handshake is distinct from verification of the Desktop installation dialog and a real conversation.
Always test a cold start through Claude's built-in runtime as well: a system-Node handshake missed
the 1.1.0 Electron helper relaunch bug. Claude disables Electron's RunAsNode fuse, so an environment
flag is insufficient. The Desktop service must launch the bundled standalone executable.
On 2026-09-05, the exact bundle passed that unpacked handshake (25 tools, inline icon, background mode).
Claude Desktop opened its installation dialog with the new basket icon and reported all requirements met.
The final install confirmation is pending explicit approval of Claude's local-extension access warning;
the existing manual connection was restored. This is not yet a completed bundle installation test.

The same day's live discovery check verified background mode, filtering of unrelated results for
“protein chips,” and description/specification extraction from a RedMart peanut-butter page.
The page did not expose labelled ingredients or nutrition; those positive extraction cases are fixture-tested
only. The optional isolated Chrome/CDP adapter test also passed separately (one test, none skipped).


## Comparison layout and reinstallation

On 2026-09-06, picker v2 was checked in an isolated browser host with fixture data. The table appears
above photo cards for the same candidates; a thumbnail loads, missing photos have an explicit label,
and quantities start blank with review disabled. This verifies component rendering, not Claude/Grok
hosting or live CDN image loading. The isolated suite passed (39 passed, one optional adapter skipped).

At the owner's request, the manual Claude Desktop Lazada registration and Grok's installed Lazada
connector were removed for a fresh owner-led install. Saved sessions were preserved. The new Desktop
bundle and npm archive contain picker v2. After reinstalling, test in a new conversation:

> Compare three oat milks. Show a comparison table and then product photos for the same options.
> Ask about missing quantity and quality. Do not change my cart.

Verify actual Show Grocery Choices tool use, the table above the cards, correct product photos or
explicit missing-photo labels, and no cart changes. On clients without MCP Apps, check the table plus
inline returned product images (if supported) and an honest explanation of the fallback.


## One-command release installer

`scripts/install.sh` is a template. `npm run package:release -- OWNER/REPO` builds version-pinned
release assets under `releases/vVERSION`: `install.sh`, `lazada-mcp.tgz`, `lazada-mcp.mcpb`, and
`SHA256SUMS`. Publish those four assets together. The public latest installer embeds the immutable
tag URL so a later release cannot mix its archive and checksum. Checksums detect corrupted/mismatched
assets; they are not a signature from an independent trust authority.

Installer fixtures cover client argument handoff, temporary-file cleanup, failed downloads, checksum
mismatch refusal, invalid locations, and a persistent verified Desktop bundle handed to the native
installer. Tests do not register real clients or approve installation dialogs. Claude Desktop approval
and Grok registration remain explicit host steps. Never substitute a successful scripted handshake for
a completed native installation test.


The 1.1.0 release verification also runs real npm against the prebuilt archive in a disposable install
root. This caught a positional-archive invocation being treated as an executable; the installer now
uses explicit `--package=...` and the `lazada-mcp` binary. Mocked argument tests alone do not prove npm
package resolution. The real check prints configuration only and never registers a live client.

## Claude Desktop 1.1.1 startup verification

On 2026-09-06, upgraded the installed extension through Claude's native Update/Install dialogs.
Disabled the extension, stopped the idle shared service, and enabled it again to test a cold start.
The new daemon came from the installed extension and ran its packaged Apple Silicon Node binary;
Claude Developer settings reported Running and initialization plus tool/resource discovery succeeded.
No Keychain approval was needed for the corrected startup. Intel Node is bundled and checksum-verified,
but an Intel Mac execution test remains pending.

A real Claude Desktop conversation then called connection diagnostics, session check and product search.
It reported version 1.1.1, a signed-in session and three live product results. No login flow, cart mutation
or ordering call was requested or made. Search relevance remains imperfect: the Oatly oat milk query
also returned other brands and a dairy smoothie. This verifies transport and browser reads, not exact
brand matching or complete shopping/visual-comparison behavior.

The isolated suite passed 44 of 45 checks with one optional browser test skipped. The regression guard
checks that Electron hosts select only the packaged runtime and fail with a reinstall instruction if it
is absent, instead of falling back to the GUI helper.

## Picker sizing and fullscreen (1.1.2)

Verified the native Claude Desktop update and a real eight-group comparison on 2026-09-06.
Expand opened Claude's fullscreen surface with real product photos and tables; Collapse returned to
the conversation. No products were selected or added during this display test. The previous shortlist
had expired, so Claude rebuilt the same eight queries with unknown quantities before rendering.
Search relevance remains a separate open limitation.

The isolated suite passed all 46 checks with `LAZADA_TEST_CHROME` set, including both browser tests.
The picker fixture starts with a 150px iframe, checks size notifications, native-host display-mode
requests, selection/quantity preservation, host refusal, unsupported fullscreen, scrollable content,
and absence of cart calls. Protocol coverage checks that the v2 resource address still resolves.
Codex and Grok fullscreen behavior is not yet verified in those hosts.

## Pack comparison and durable shortlists (1.1.3)

The picker shows pack size, listed price per pack, chosen pack count, and line total. Normalized
per-kilo/litre prices are omitted from comparisons unless requested. Missing pack sizes remain
explicitly unavailable; photos are never used to infer weight. Cards keep quantity controls below
the product details and ratings use one decimal. Browser fixtures cover 380px and 600px widths.

Previous drafts lived only in memory: restarting the service during an extension update could
discard a still-fresh shortlist. Drafts now persist in the private data directory (0700 directory,
0600 file). Prices retain their 30-minute freshness window; expired drafts can still be displayed.
Refresh options keeps exact matching product choices and quantities, updates prices, and requires
a fresh review and confirmation. Missing, expired, and already-submitted drafts have distinct errors.
The submission marker is durably saved before cart operations, preventing replay after a partial
failure or restart. Isolated tests exercise restart, expiry, corruption, partial failure, and refresh;
no live cart mutation is used for these checks. Drafts lost by older versions cannot be recovered
from disk and need a fresh comparison.
