# Setup

## Local clients: Codex and Claude Code

The friend-facing instructions are in [README](README.md). With Node.js 22+ and Chrome available,
setup is one command (the installer downloads and verifies the package for you):

```bash
curl -fsSL https://github.com/Rajat-Goyal/lazada-community-mcp/releases/latest/download/install.sh | sh -s -- codex
# Or:
curl -fsSL https://github.com/Rajat-Goyal/lazada-community-mcp/releases/latest/download/install.sh | sh -s -- claude-code
```

For a clone or extracted archive, use `node scripts/setup.mjs codex` or `node scripts/setup.mjs claude`.
Setup installs a private, versioned copy under `~/.lazada-mcp/apps`, installs its pinned dependencies,
and builds only when compiled code is absent (fresh clones). It uses the client's official MCP CLI
with an absolute Node executable and launcher path. It does not copy sessions, diagnostics, other
worktrees, or the checkout's dependencies. Downloads and npm's temporary cache can be removed afterward.

`setup config` installs the same stable copy and prints JSON for other MCP clients. Setup does not
restart an active shopping service or modify browser settings. If replacing an existing named MCP
registration fails, ask your agent to inspect that client's `lazada` registration; do not remove other
servers. An already-installed Codex marketplace plugin should be updated through the marketplace instead
of adding a second registration.

Releases ship prebuilt JavaScript. Maintainers run `npm pack` to build and generate the `.tgz` archive;
recipients never need to type `npm ci` or `npm run build`. This package is not yet published to npm.

For development only:

```bash
npm ci
npm run build
npm test
npm run config:print
```

The configuration command prints absolute paths for the current checkout. The repository's `.mcp.json`
is relative for project/plugin use; `scripts/launch-mcp.mjs` resolves files relative to the plugin.

Use one registration per client to avoid duplicate tool namespaces. This repo has both
`.codex-plugin/plugin.json` and `.claude-plugin/plugin.json`; the latter uses `${CLAUDE_PLUGIN_ROOT}`
for plugin installation. A Claude plugin can also be tried with `claude --plugin-dir /absolute/path/to/lazada-mcp`.
The shared skill is `skills/lazada-shopping/SKILL.md`; plain MCP clients also receive server instructions.

Once registered, ask: **“Connect Lazada.”** Complete sign-in in the visible browser, then say you are done.
`start_login` opens or reuses the window and returns promptly. `capture_session` checks and persists the session.
For development, `npm run login` and `npm run login:complete` call those same tools through the shared service.

Open as many local tasks as needed. All clients using the same `LAZADA_DATA_DIR` use the same service.
Lazada may eventually expire the session; then sign in again once. Different machines and data directories
are separate sessions. The service shares the live account/cart, not an isolated cart per task.

## Claude Desktop chat

For a new macOS Desktop installation, run `curl -fsSL https://github.com/Rajat-Goyal/lazada-community-mcp/releases/latest/download/install.sh | sh -s -- claude-desktop`. It downloads and verifies the bundle, opens Claude, and leaves the native installation approval to you. It bundles production dependencies and uses the Node runtime supplied by Claude; Chrome must be installed. It is an unsigned community preview, not a directory-listed extension.

When replacing the existing local-dev registration, have your assistant back up the configuration and remove only its `mcpServers.lazada` entry before enabling the bundle, then fully quit/reopen Claude. Keep other servers and your saved Lazada session. Do not enable both registrations.

`setup claude` registers **Claude Code**, not Claude Desktop chat. For the manual Desktop alternative, ask your assistant to
run `npx --yes --package=./lazada-mcp-1.1.0.tgz lazada-mcp setup config` and merge the printed `lazada` entry into
`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, preserving other servers
and any existing Lazada environment settings. Then fully quit Claude with **Cmd+Q** and reopen it.
Ask it to check the Lazada connection and search for a product without changing your cart.

### Every tool says “Tool execution failed”

If even **Diagnose Lazada Connection** fails, check **Settings → Desktop app → Developer → lazada**.
The general Connectors page can still say “Connected” while Developer reports **Failed / Server disconnected**.
A service restart during an update can leave Claude attached to the old, closed connection.

Fully quit and reopen Claude, then ask it to check the connection before retrying shopping. Opening
another chat alone may not reconnect the desktop process. No new Lazada login should be needed if
the saved session is still valid. If an add/remove/order call was interrupted, inspect the cart or
order status before retrying it; a lost response does not establish whether the action ran.

If reconnecting still fails, inspect the local `mcp-server-lazada.log` in `~/Library/Logs/Claude`
and run `npm run doctor` from the checkout. Keep raw logs private. Do not delete the browser profile.

## Browser configuration

| Variable | Default | Meaning |
|---|---|---|
| `LAZADA_DATA_DIR` | `~/.lazada-mcp` | Private service socket, metadata, log, session and memory root |
| `LAZADA_PROFILE_DIR` | data directory + `/profile` | Persistent dedicated shopping profile |
| `LAZADA_STORAGE_STATE` | data directory + `/storageState.json` | Private cookie snapshot written on capture/clean shutdown |
| `LAZADA_LOGIN_MODE` | `auto` | `local`, `host`, or desktop/display detection |
| `LAZADA_CDP_URL` | unset | Operator-provided endpoint for the host-visible browser; attach only, no fallback launch |
| `LAZADA_BROWSER_EXECUTABLE` | unset | Explicit installed Chrome/Chromium executable |
| `LAZADA_BROWSER_CHANNEL` | `auto` | Installed Chrome/Chromium detection; empty means bundled Chromium |
| `LAZADA_HEADLESS` | `1` | Routine local shopping is headless; `0` explicitly keeps it visible. Human login opens a window and capture returns to background mode. Host CDP visibility is owned by the host. |
| `LAZADA_MAX_ORDER_TOTAL` | `300` | Hard per-order SGD ceiling |
| `LAZADA_REVIEW_TOKEN_TTL_MS` | `300000` | Review token expiry, 10 seconds–30 minutes |
| `LAZADA_DEBUG_DIR` | data directory + `/debug` | Private focused diagnostic artifacts |

Installed browser detection checks ordinary macOS/Linux locations. Use an explicit executable for
other layouts. If no installed browser is found, install bundled Chromium with `npx playwright install chromium`.
A browser launch error names the next action instead of being mislabeled “signed out”. Never point the service
at your everyday browser profile while another process owns it. CDP mode uses a dedicated shopping tab
inside the configured browser and disconnects without shutting down that browser.

`npm run doctor` shows the active version, source, and mode. After a code/config update, use
`npm run service:stop` while shopping tasks are idle, then reconnect. Login persists. An old pre-consolidation
MCP may still own the profile; close that old Lazada process once, rather than creating a new login.
After stopping the shared service, fully quit/reopen Claude Desktop and reconnect other MCP clients;
existing client connections do not automatically migrate to the new service.
Do not manually remove Chrome profile locks from a live browser.

## Grok Bot's shared computer

The default is a separate session per computer: one shared login and shopping memory on the Mac,
and another on Grok's shared cloud computer. New tasks on either computer reuse that computer's session.
This does not require cookie-sync software or an always-online Mac. Memory is local to each computer.

Grok Bot runs on a cloud computer. Its visible Chrome is not the Chrome on your Mac.
The VM adapter must provision a reachable Chrome debugging endpoint and configure:

```json
{
  "mcpServers": {
    "lazada": {
      "command": "node",
      "args": ["/absolute/vm/path/lazada-mcp/scripts/launch-mcp.mjs"],
      "env": {
        "LAZADA_LOGIN_MODE": "host",
        "LAZADA_CDP_URL": "http://127.0.0.1:PORT_PROVIDED_BY_HOST"
      }
    }
  }
}
```

The placeholder must be replaced with the actual provisioned endpoint. Do not guess ports, scrape
credentials, or restart Grok's shared browser to add debugging flags. When the host does not expose
browser attachment, `start_login` reports `host_browser_required` or `HOST_BROWSER_UNREACHABLE`.
A login URL alone cannot transfer a session to another browser. Cookie copying is not the user-facing flow.

Alternatively, route Grok's MCP requests to the authenticated gateway on the machine where you already signed in.
That reuses the Mac's session and memory, but requires a reachable private/HTTPS route and client authentication.

## HTTP gateway for cloud harnesses

The gateway is an optional adapter to the same local service. It does not create another browser or account.
Provision a random bearer token of at least 32 characters in a private file; do not put it in chat or Git.
Then:

```bash
LAZADA_HTTP_TOKEN_FILE=/private/path/to/token npm run serve:http
```

Default: `http://127.0.0.1:8787/mcp`. Each request must carry `Authorization: Bearer <token>`.
`LAZADA_HTTP_PORT`, `LAZADA_HTTP_HOST`, and `LAZADA_HTTP_ALLOWED_ORIGINS` (comma-separated exact origins)
are operator settings. Requests with an Origin are rejected unless explicitly allowed. Never publish
an unauthenticated gateway, debugging endpoint, cookie file, or browser profile.

Cloud clients cannot reach your Mac's localhost directly. Use a deliberate authenticated HTTPS/private route.
The bundled gateway supports bearer authentication, not a full OAuth authorization server. A client requiring
OAuth needs an authenticated proxy/adapter before installation. **An HTTP protocol test is not proof of a
working ChatGPT Work cloud or Grok app connection.** Local Work on the same Codex host can use the local MCP.

Current host capabilities are documented by [OpenAI MCP docs](https://learn.chatgpt.com/docs/extend/mcp),
[Claude Code plugin docs](https://code.claude.com/docs/en/plugins-reference), and
[Grok Bot setup](https://docs.x.ai/grok-bot/get-started). Check the actual host settings before promising
that a local plugin install also enables its cloud runtime.

## Verify without buying

```bash
npm test
npm run validate:plugin
npm run test:live
```

Run live checks while shopping tasks are idle: they navigate the shared browser and revoke any pending
checkout review, but do not mutate the cart. The report is saved privately under
`LAZADA_DATA_DIR/checks/latest.json` (default `~/.lazada-mcp/checks/latest.json`). See
[the capability matrix and recurring maintenance workflow](docs/TESTING.md). A successful read check
does not claim live verification of cart writes, delivery-slot selection, or the final purchase click.

For manual checks: `session_status` → `whoami` → `get_cart` → `get_shopping_memory(refresh=true)` →
`shortlist_products`. No item is added merely by comparison. Ask about quantity and quality, and inspect
promotions before a requested cart change. Never call `place_order` successfully as a test.

Memory stays under the signed-in account's hashed local namespace, with atomic private writes.
`forget_shopping_memory` clears a preference or account memory. It does not erase Lazada orders.
Session files contain authentication material: use them only on the trusted host, not in chat or backups
shared with others. Only Lazada Singapore cookies are retained.

To exercise the host-browser adapter with a disposable Chrome profile, set `LAZADA_TEST_CHROME` to
an installed Chrome executable and run `npm run test:browser`. This test never signs into the real account.
It is opt-in because normal tests should not launch browsers on machines without a configured browser.

## Icons and tool presentation

The independent red basket icon is embedded in MCP `serverInfo.icons` as a data URI, so it does not depend
on a filesystem URL or remote asset server. The Codex manifest uses the documented `interface.composerIcon`
and `interface.logo` fields; the Desktop bundle supplies its own icon. These advertise identity, but hosts
choose whether and where to show it. They also own tool-card layout, grouping, and animations. The MCP
Apps picker is the optional surface this project controls for compact product comparisons.

## Quiet browser behavior

Routine local calls default to headless Chrome. `start_login` opens a visible window only when human sign-in
is needed; after the human finishes, `capture_session` saves the session and closes that local login window.
The next browser operation reopens the same private profile headlessly. `LAZADA_HEADLESS=0` is an explicit
visible-mode override. Host CDP mode does not close or hide the host's browser.

A headless challenge is reported, not automatically retried or bypassed. If human attention is needed,
use the login flow for expired authentication, or explicitly configure visible mode for an attended challenge
check. Do not assume that successful API login checks prove every product page is challenge-free.
