<p align="center"><img src="docs/assets/banner.svg" alt="Lazada MCP — your groceries, your choices, your final say" width="100%"></p>

<p align="center"><strong>Your RedMart shopping assistant, inside your AI.</strong><br>
Find your usuals. Compare a few good choices. Approve the basket before buying.</p>

<p align="center"><a href="#1-codex--chatgpt">Get started</a> · <a href="#try-it">Try it</a> · <a href="#project-health">Project health</a> · <a href="CONTRIBUTING.md">Contribute</a></p>

## 1. Codex / ChatGPT

**Ask your Codex assistant to install it for you:**

> Install Lazada community MCP with this, connect it to Codex, and tell me when to sign in: `curl -fsSL https://github.com/thebuilderscollective/lazada-community-mcp/releases/latest/download/install.sh | sh -s -- codex`

The assistant needs command execution on the computer where Codex runs. The current installer requires
Node.js 22+, Chrome, and the Codex CLI there; ask the assistant to check these first. You don't need to type the command in Terminal yourself.

The installer downloads and verifies the release, then connects Lazada to Codex. Source setup also installs the shopping skill so grocery requests can discover the MCP before using a browser. The published 1.1.3 installer predates that addition.

Open a new task → **“Connect Lazada”** → sign in in the browser. Other local tasks reuse your login.
Already installed through the Codex marketplace? Update that plugin instead of adding a second connection.
**ChatGPT Work in the cloud needs a hosted connection and is not yet verified.** [Setup details →](SETUP.md)

## 2. Claude

**Claude Desktop on Mac — download, open, install:**

[Download the latest Desktop bundle →](https://github.com/thebuilderscollective/lazada-community-mcp/releases/latest/download/lazada-mcp.mcpb)

Open the newly downloaded `.mcpb` file and click **Install** in Claude. Open a new chat and say
**“Connect Lazada.”** Sign in in the browser when prompted. No Terminal, separate Node.js installation,
or Claude Code required. Chrome is required.

If you have an assistant with command execution on the same Mac, you can instead ask it:

> Install Lazada community MCP for Claude Desktop with this and open the installation dialog: `curl -fsSL https://github.com/thebuilderscollective/lazada-community-mcp/releases/latest/download/install.sh | sh -s -- claude-desktop`

If you already have a local `lazada` connection, follow the [upgrade guide](SETUP.md#claude-desktop-chat) to avoid duplicates.

**Claude Code — ask your assistant:**

> Install Lazada community MCP with this, connect it to Claude Code, and tell me when to sign in: `curl -fsSL https://github.com/thebuilderscollective/lazada-community-mcp/releases/latest/download/install.sh | sh -s -- claude-code`

Node.js 22+, Chrome, and the Claude CLI are required on that computer. Desktop and Code have separate
registrations; both share the same login and memory on your Mac.

## 3. Grok — testing 🧪

**Ask your Grok bot:**

> Install Lazada community MCP with this, then register it using host-browser settings and tell me when to sign in: `curl -fsSL https://github.com/thebuilderscollective/lazada-community-mcp/releases/latest/download/install.sh | sh -s -- grok`

When the bot says login is ready, open **its desktop/browser** and sign into Lazada/RedMart once.
Enter passwords and verification codes directly in that browser.

Then ask:

> What's in my RedMart cart?

> Search RedMart for oat milk, show 3 options with images, don't change the cart.

The bot needs command execution and MCP registration access on its computer. This command installs
the runtime and prints configuration; the bot must register it using the host's actual browser settings.
**Grok's session lives on Grok's computer, not in your Mac's Chrome.** Image display depends on the client.
Fresh-install and visual comparison verification are pending.
[Shared-computer guide →](SETUP.md#grok-bots-shared-computer)

**One installer, four targets:** `codex` · `claude-code` · `claude-desktop` · `grok`.
Swap the last word for the app you want to connect. Command-line targets need Node.js 22+ and Chrome
on the execution computer, on macOS or Linux; the Claude Desktop bundle is macOS-only and includes Node.js.
Grok also needs its host-browser integration. This is a community MIT preview, not official Lazada software.

<details><summary>Requirements and downloads</summary>

Downloads are available from [GitHub Releases](https://github.com/thebuilderscollective/lazada-community-mcp/releases).
Released under the [MIT license](LICENSE): use, modify, and share it, including commercially, while retaining the license notice. The package is not published to npm. This is an independent community preview, not an official Lazada/RedMart integration.
The local runtime supports macOS and Linux; the Desktop bundle targets macOS. Windows is not supported yet.
Command-line setup needs Node.js 22+ and Chrome. Fresh clones can use `node scripts/setup.mjs codex` or
`node scripts/setup.mjs claude`; your agent handles dependencies and builds. [All setup options →](SETUP.md)

</details>

## Try it

After sign-in, these read-only checks work as starting prompts in any connected client:

> What's in my RedMart cart?

> Search RedMart for oat milk, show 3 options with images, don't change the cart.

For a comparison with your purchase history:

> **You:** “Compare oat milk with my usual purchases. Show three choices and any multi-buy deal. Don't change my cart.”
>
> **Assistant:** A comparison table followed by product-photo cards, with links to the exact Lazada listings, pack sizes, prices per pack, pack quantities, line totals, and purchase history.
> It asks about missing quantity or quality before adding anything.

*Illustrative flow; live products and prices vary. Visual choices appear in clients supporting MCP Apps. Use **Expand** for a larger comparison and **Collapse** to return to chat; fullscreen depends on the client.*

| Ask for… | What you get |
|---|---|
| Your usual groceries | Observed recent purchase frequency and saved preferences |
| A better choice | Shortlists, pack sizes and prices, stock, and current offers |
| Ingredients or nutrition | Lazada's labelled details when readable; an explicit gap when unavailable |
| A basket review | Selected items, delivery, fees, total, and a fresh approval step |

Lazada stays the source for products and shopping. External ingredient research requires your approval.
[All 25 tools →](docs/TOOLS.md)

## Where your login and preferences live

Local Codex and Claude use the same `~/.lazada-mcp` directory by default—no manual path configuration is needed.

| Local data | Location |
|---|---|
| Saved browser login | `~/.lazada-mcp/profile/` |
| Account-specific product preferences and observed order history | `~/.lazada-mcp/memory/` |
| Saved comparison drafts | `~/.lazada-mcp/shortlists/` |

Ask either assistant to remember a product using the Lazada integration, and the other can read that preference.
Notes saved only in Claude's or Codex's own chat memory are separate. Memory records are separated by a hash of the
Lazada account ID. File permissions are private to the local OS user; the data is not an encrypted vault.
Set `LAZADA_DATA_DIR` in each MCP configuration only if you want a different shared root; a separate
`LAZADA_PROFILE_DIR` changes the browser profile. Different computers, cloud VMs, or data roots do not automatically sync.
Browser operations are serialized across clients; coordinate cart edits since both assistants affect the same cart.

## Quiet shopping, clear approval

- **Background by default.** Local shopping runs headlessly. Human sign-in opens a visible window; completing
  sign-in returns to background mode. An explicitly configured visible mode or Grok's host browser stays visible.
- **You choose.** Missing quantity and quality are clarified. Extra units for a deal need approval.
- **You approve the exact checkout.** A fresh one-use review token and a default S$300 ceiling guard ordering.
  Tests never place orders.
- **Local session storage.** Login profiles and shopping memory stay in a private directory. Your assistant
  receives the requested shopping results; private files are excluded from packages and public test reports.

Challenges may still require a human. Headless mode does not bypass site protection. After a service update,
Claude Desktop may need a full quit/reopen. [Troubleshooting →](SETUP.md#every-tool-says-tool-execution-failed)

## Project health

<!-- health:start -->
| Check | Last reported result | Last checked |
|---|---|---|
| Isolated smoke suite | ✅ Passed · 50/50 passed; 0 skipped | 2026-09-06 15:18 UTC |
| Live Lazada browser reads | ✅ Passed · 12/12 checks | 2026-09-05 18:57 UTC |
| Codex | 🟡 Partial · Installed and enabled; MCP verified, full shopping conversation pending | 2026-09-05 17:48 UTC |
| Claude Code | ✅ Passed · Real prompt: login reuse + shortlist + preference questions | 2026-09-05 17:41 UTC |
| Claude Desktop | 🟡 Partial · 1.1.2: real photo comparison, fullscreen expand/collapse, session reuse and search verified; relevance still needs review | 2026-09-06 14:48 UTC |
| Grok | 🟡 Partial · Old connector uninstalled in app; owner reinstall and visual test pending | 2026-09-06 04:48 UTC |
| ChatGPT Work cloud | ⚪ Not verified · Host integration pending | Not run |

*Dated maintainer reports, not an uptime monitor or a guarantee for your account. A report older than seven days should be rechecked. Skipped tests are not passes.*

[Machine-readable snapshot](docs/health.json) · [What is and isn't covered](docs/TESTING.md#capability-coverage)
<!-- health:end -->

**Is it brittle?** Website changes can interrupt shopping. Read checks do not prove cart writes, delivery choices,
or checkout work. The [coverage matrix and run notes](docs/TESTING.md) make those gaps explicit.
Run `npm run smoke -- --live` while shopping is idle to refresh the dated report; no schedule is enabled automatically.

## Build with us

Confusing setup steps, reproducible bugs, and real client test reports all help.
[Contributing](CONTRIBUTING.md) · [Testing](docs/TESTING.md) · [Verified site findings](docs/MAINTENANCE.md) · [Architecture](docs/CONSOLIDATION.md)

---

Created by **Rajat Goyal** and **[The Builder Course community](https://github.com/thebuilderscollective)**.
[Connect with Rajat on X](https://x.com/profile/rajat-rg18).

If you use or build on this work, we'd appreciate a credit to Rajat and The Builder Course community,
with a link to [this repository](https://github.com/thebuilderscollective/lazada-community-mcp).
This is a friendly request, not an additional license condition. The [MIT license](LICENSE) requires
retaining the copyright and permission notice in copies or substantial portions of the software;
it does not require a public shout-out or backlink.
