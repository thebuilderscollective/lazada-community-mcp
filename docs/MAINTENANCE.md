# Maintenance

## Claude Desktop startup fix (1.1.1, 2026-09-06)

Claude's built-in Node host is an Electron utility process. Relaunching `process.execPath`
as the detached Lazada daemon in 1.1.0 instead started a GUI helper: the service log contained
`Unable to find helper app`, while Claude's main log reported `Shared Lazada service did not start`.
An unexpected Claude Safe Storage Keychain prompt accompanied the owner's failed startup.
Claude disables Electron's RunAsNode fuse, so setting `ELECTRON_RUN_AS_NODE` is insufficient.
The Desktop bundle now carries checksum-pinned official Node 22 binaries for both Mac architectures
with their licenses. Electron-hosted clients explicitly select that standalone runtime; a missing
binary produces an actionable reinstall error and never falls back to the GUI helper.
Ordinary Node clients retain their current executable. The shared profile and service remain unchanged.

Verified cold startup through the installed Claude 1.1.1 extension: Claude reports Running,
initialization and tool/resource discovery succeed, and the daemon executable is the bundle's
`runtime/darwin-arm64/node`. The original 1.1.0 package handshake used system Node and missed this.
See [Electron's fuse documentation](https://www.electronjs.org/docs/latest/tutorial/fuses).


Lazada rewrites its markup regularly and its search-page CSS classes are minified and rotate
(`Bm3ON`, `RfADt`, …). This code therefore keys off stable hooks only: `data-qa-locator`,
`data-item-id`, the cart's explicit `automation-*` classes, Alibaba's `next-*` design-system
classes, and structured page models. When a tool reports it can't find something, run
`probe_page` on that URL — it dumps live endpoints, locators and a screenshot to `debug/`.

### Hosts and URLs (all verified against the live site)

Several obvious-looking URLs are 404s. The real ones:

| Purpose | URL |
|---|---|
| Sign in | `member.lazada.sg/user/login` → redirects to `pages.lazada.sg/…/login-signup` |
| Cart | `cart.lazada.sg/cart` |
| Checkout | `checkout.lazada.sg/shipping` |
| Recent orders | `my.lazada.sg/api/recentOrders/` (JSON, HTML-entity **escaped**) |
| Session check | `member.lazada.sg/user/api/getContextInfo` — `module.userId` is null when signed out |
| Address book | `member.lazada.sg/address` → `#/book`; the page requests `/address/api/listAddress` |

**404 traps:** `www.lazada.sg/user/login/`, `www.lazada.sg/cart/`, `www.lazada.sg/customer/order/index/`.

### Data sources

- **Search** — RedMart scope is the `service=RedMart_SRP_Filter` facet on `/catalog/`, i.e.
  "fulfilled by RedMart", the whole grocery range. `/redmart_/` is a narrower **own-brand**
  filter and will not find Oatly or Danone.
  `GET /catalog/?ajax=true&page=1&q=…&service=RedMart_SRP_Filter` returns `mods.listItems`
  as JSON, unsigned. Items carry `itemId`, `skuId`, `price`, `sellerName`, `inStock` — but
  **no product URL**; build it as `/products/pdp-i<itemId>-s<skuId>.html`.
  Search pages have **no** `window.pageData`.
- **Product** — PDPs expose `window.__moduleData__.data.root.fields`. RedMart items use
  `*_grocer` module variants keyed by SKU id, e.g. `price_grocer.<sku>.data.price.priceText`
  and `skuInfos.<sku>.stock`.
- **Cart** — served by `mtop.lazada.carts.ultron.query.cutover`, which **is** signature-protected.
  Rather than forge a signature, the server loads the page and reads the response the page
  itself requested. Format is Alibaba "Ultron": a flat map of components keyed by id, each
  `{ tag, id, fields }`; items are the `tag === "item"` entries.

### Behaviours that will bite you

- **The cart is paginated.** The first response carries ~22 lines; a "LOAD MORE" control
  fetches the rest. A naive read reported 22 of 64 lines. `get_cart` pages through and merges,
  deduping by `cartItemId`.
- **Only *ticked* lines check out.** A full cart still totals $0.00 if nothing is selected, so
  `select_cart_items` is a required step, not a convenience.
- **Reach checkout via the cart button, never by URL.** Navigating straight to
  `checkout.lazada.sg/shipping` can render a *stale checkout session* from an earlier visit —
  showing an unrelated basket and the wrong (non-RedMart) delivery options. `review_checkout`
  always clicks PROCEED TO CHECKOUT from the cart, and `place_order` refuses to navigate at all.
- **The cart-count badge (`cart/api/count` → `module.cartNum`) is unreliable** — it disagreed
  with the real line count (80 vs 61 units). Trust `get_cart`.
- **RedMart PDPs have no "Add to Cart" button.** The control is a quantity stepper
  (`.redmart-cart-picker`) whose value *is* the cart quantity. Two pickers on the page share
  one value.
- The checkout total includes shipping and platform fee (e.g. $2.43 + $5.99 + $0.60 = $9.02).
  That combined figure is what `place_order` must be given as `expected_total`.
- A RedMart order also needs a **delivery time slot**, which is a second choice inside the
  delivery option — `review_checkout` reports `slotStillNeeded`.

## Additional findings from consolidation (2026-09-06)

- The recent-orders response contains `tradeOrderId`, `createdAt` in DD/MM/YYYY form, and item rows
  with `itemId`, `title`, and `picUrl`. The same item can appear repeatedly inside one order, but
  there is no explicit quantity or SKU field. Frequency counts distinct observed orders; repeated
  rows are recorded separately as occurrences, never reported as verified units.
- Live cart snapshot before consolidation checks: 69 lines, 0 selected. No order was placed.
- Multiple independent Chrome launches contend for the same profile. Sharing an in-process
  promise was insufficient; the consolidated service serializes operations across MCP processes.
- Live maintenance checks found that `my.lazada.sg/address/` renders an empty account shell.
  The real Address Book navigation goes to `member.lazada.sg/address`, which exposes the saved list.
- Unavailable, unselected cart lines may have null quantities. Preserve unknown values; require
  readable quantities on available or selected lines, and compare full before/after snapshots.
- A listing such as “Organic Oat Milk Drink 1L - Case” does not establish the case count.
  Pack and unit price stay unknown until an explicit count is available; “6 x 1L - Case” is comparable.



## Product discovery and content (2026-09-06 Singapore time)

- A live RedMart `protein chips` search returned unrelated popular products (beer, soda, herbs), with a
  positive `totalResults`. It is not a reliable no-results signal. Search now checks title relevance, supports
  common synonyms, and leaves broad category searches explicitly needing review. Filtered catalog totals
  become unknown; raw totals remain labelled `storefrontTotalAvailable`. This is a conservative lexical
  guard, not semantic or dietary certification, and does not prove catalog-wide absence.
- On Oatly Barista and Forty Thieves Crunchy peanut butter PDPs,
  `__moduleData__.data.root.fields.attributes_grocer[sku].data.attributes` contains
  `{title, description: {text}}` rows for About Product / Dietary Needs / Dietary Information.
  `product_attributes_grocer[sku].data.attributes` contains `{name, value}` rows for Pack Size / Place of Origin.
  These are the only newly added extraction paths. A missing requested SKU does not borrow another SKU's content.
- Those sampled PDPs exposed descriptions and specifications, but no dedicated ingredient list or nutrition
  table. Nutri-Grade and general vitamin claims stay labelled dietary attributes. The extractor also preserves
  ingredient/nutrition-labelled rows when present on these verified paths; their positive case currently has
  fixture coverage, not a live observation. Missing/image-only content is explicitly unavailable; no OCR or
  external request is made by `get_product`.
- Product content and search fields are untrusted data. Server instructions and the shopping skill require
  approval before external enrichment; they cannot control a host's independent web tools mechanically.

## Browser/reference review

Reviewed [Blinkit MCP at b6e57df](https://github.com/hereisSwapnil/blinkit-mcp/tree/b6e57dfed13a8ba4e91728c1b5bbf5217d90d1ca).
Its `src/server.py` reads `HEADLESS` (default `true` when unset); `src/auth/service.py` launches Firefox
with that fixed setting and restores storage state. `login` / `enter_otp` drive hidden form inputs from
MCP arguments. No automatic headed/headless transition or explicit CAPTCHA handoff was found in that
browser/login code. Its manifest advertises an icon and its `.mcpb` provides a convenient Desktop install.
Our implementation retains human-only sign-in, persistent profiles, global serialization, and exact checkout
approval. No Blinkit code was copied. The icon is an original temporary basket, not an official trademark.

## Picker height and display modes (1.1.2)

The dependency-free picker previously sent neither `ui/notifications/size-changed` nor fullscreen
capabilities, so Claude left long comparisons inside its short initial iframe. It now announces
inline/fullscreen support, measures a bounded viewport, and honors host container constraints.
A persistent Expand/Collapse control requests only advertised modes via `ui/request-display-mode`,
respects the resulting mode, and follows host-context changes. Products scroll between the header
and footer. The older v2 resource remains available for previous conversations.

Verified against the [MCP Apps specification](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)
and in Claude Desktop with an eight-group live comparison. No cart mutation was made.
