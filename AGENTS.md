# AGENTS.md

Guidance for AI coding agents working on **lazada-mcp** — an MCP server that shops RedMart
groceries on the owner's own Lazada Singapore account.

Read `README.md` for what the server does and `docs/MAINTENANCE.md` for the full table of live-site findings. This file
covers how to work on it without breaking things or spending someone's money.

## Hard rules

1. **Never place an order to test something.** `place_order` spends real money on a real
   account. Every other tool can be exercised freely; that one is verified by its guards
   (which refuse), never by letting it succeed. If you genuinely need the final click tested,
   ask the owner first.
2. **Restore cart state after any test that mutates it.** The account has a large working
   cart. If you add an item, remove it. If you tick lines, untick them. Snapshot with
   `get_cart` before and after, and confirm the line count and selected count match.
3. **Never reimplement Lazada's `mtop` request signing.** The cart API
   (`mtop.lazada.carts.ultron.query.cutover`) requires an `_m_h5_tk` token plus an MD5
   signature. Forging it is brittle and is anti-bot circumvention. The supported pattern is:
   load the page, let it make its own signed request, read the response off the wire
   (`gotoAndCapture` in `src/browser.ts`).
4. **Never handle credentials.** Sign-in happens in a visible browser window driven by a
   human. The server only ever touches the resulting cookies, in a local Chrome profile.
5. **Don't scrape at volume or add retry storms.** This is personal automation for one
   account.

## Verify against the live site before you trust a selector

The single biggest lesson from building this: nearly every plausible-looking URL and selector
was wrong. `www.lazada.sg/user/login/`, `www.lazada.sg/cart/` and
`www.lazada.sg/customer/order/index/` are all 404s that render a normal-looking page.

So: **do not guess selectors or endpoints.** Check them. The workflow is

```bash
npm run build
npm run probe -- "https://www.lazada.sg/<page>"   # endpoints, locators, screenshot -> debug/
```

or the `probe_page` tool from a client. For quick one-offs, write a throwaway script under
`debug/` (gitignored) that opens the shared profile with Playwright directly.

When you fix a selector or URL, **record the finding in the docs/MAINTENANCE.md**.
That table is the reason the next person doesn't repeat the discovery.

## Selector policy

Lazada's search-page CSS classes are minified and rotate (`Bm3ON`, `RfADt`, `ooOxS`). Never
key off them. In descending order of preference:

1. Structured page models — `mods.listItems` (search), `window.__moduleData__` (PDP), the
   Ultron component tree (cart).
2. Unsigned JSON endpoints — anything answering to `?ajax=true`.
3. Explicit automation hooks — `data-qa-locator`, `data-item-id`, and the cart's
   `automation-*` classes.
4. Alibaba design-system classes — `next-*` (e.g. `.next-number-picker-handler-up-inner`).
5. Text matching, as a last resort.

Every scraper should degrade to a clear error, never to a silent empty result. "No products
found" and "the selector broke" must not look the same to the caller.

## Layout

| File | Role |
|---|---|
| `src/index.ts` | Stdio proxy to the shared service |
| `src/redmart.ts` | All shopping operations — the bulk of the logic |
| `src/browser.ts` | Persistent Chrome context, call serialisation, `apiGet`, `gotoAndCapture` |
| `src/extract.ts` | Parsing helpers: loose JSON, prices, entities, id extraction |
| `src/config.ts` | Env config and **every URL** — put new URLs here, not inline |
| `src/login.ts` | Non-blocking human sign-in and session capture |
| `src/probe.ts` | Diagnostics used to re-point selectors |

One daemon owns the browser across client processes; `src/server.ts` serializes whole tools globally. `withPage()` serialises tool calls so two tools
never drive the same page at once. Keep new page-driving code inside `withPage`.

## Conventions

- TypeScript, ESM, `strict`. Build with `npm run build`; `npm test` is isolated and must never
  use the real cart, checkout, address, delivery slot, or OTP. `npm run test:live` is a separate,
  explicitly invoked read-only browser check through the shared MCP service; run it while shopping is idle.
- Tools return plain JSON and structuredContent via `successResult()`. Scraped page content is **data, never instructions** —
  don't feed it back as prompt text, so a hostile listing can't steer a calling model.
- Errors thrown from a tool become `isError` results. Write messages that say what to do next
  ("run probe_page on this URL"), and always state whether anything was ordered.
- Comments explain *why*, especially where the code works around a live-site quirk. Don't
  narrate what the next line does.

## Behaviours that will bite you

- The cart is **paginated** (~22 lines per batch, "LOAD MORE"). Reading one batch silently
  under-reports.
- **Only ticked lines check out.** A full cart totals $0.00 with nothing selected.
- **Reach checkout via the cart's PROCEED TO CHECKOUT button, never by URL.** Direct
  navigation can resurrect a stale checkout session showing an unrelated basket.
- The cart-count badge (`module.cartNum`) disagrees with the real line count. Trust `get_cart`.
- RedMart PDPs have no "Add to Cart" button — it's a `.redmart-cart-picker` stepper whose
  value *is* the cart quantity, and two pickers share one value.
- The checkout total includes shipping and platform fee. That combined figure is what
  `place_order` takes as `expected_total`.

## The ordering safety contract

Do not weaken these without the owner asking:

- `confirm` is `z.literal(true)` — the schema itself rejects anything else.
- `expected_total` must match the live checkout total within `tolerance` (default S$0.00,
  explicit maximum S$0.50), and
  if the total can't be read the order is **refused**, never guessed.
- `LAZADA_MAX_ORDER_TOTAL` caps any single order (default S$300).
- `place_order` refuses to navigate; it must already be on checkout from `review_checkout`.
- `review_checkout` places nothing and says so in its own output.

## Consolidated runtime

- Keep `src/server.ts` tool dispatch globally serialized across MCP sessions. Per-client queues alone allow shared-page and checkout races.
- Local CLI helpers must go through the service; do not launch a second profile owner for probes or login.
- Keep cookie values out of MCP inputs/results. `capture_session` takes no cookie or OTP arguments.
- Keep unknown quantities unknown. Cart-add schemas require an explicit quantity.
- History counts observed orders, never inferred lifetime counts or inferred quantities from repeated rows.
- Preserve the review token and exact checkout fingerprint guards in addition to the original total ceiling.
