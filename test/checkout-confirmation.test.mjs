import assert from "node:assert/strict";
import test from "node:test";

import {
  ReviewTokenStore,
  assertReviewedCheckoutMatches,
  fingerprintCheckout,
  validateOrderRequest,
} from "../dist/checkout-confirmation.js";

function snapshot(overrides = {}) {
  return {
    basket: [
      {
        identity: "data-item-id:123|data-sku-id:456",
        quantity: "2",
        summary: "Oat Milk 2 $7.00",
      },
    ],
    deliverTo: "A User 1 Example Road Singapore 123456",
    paymentMethod: "****1234",
    deliverySelection: ["Tomorrow 10:00–12:00"],
    feeSummary: ["Subtotal $7.00", "Shipping $1.99", "Platform fee $0.10"],
    totalBlock: "Total $9.09",
    total: 9.09,
    currency: "SGD",
    ...overrides,
  };
}

test("checkout fingerprint is deterministic and covers the complete review", () => {
  const first = snapshot();
  const reordered = {
    currency: "SGD",
    total: 9.09,
    totalBlock: "Total $9.09",
    feeSummary: first.feeSummary,
    deliverySelection: first.deliverySelection,
    paymentMethod: first.paymentMethod,
    deliverTo: first.deliverTo,
    basket: first.basket,
  };
  assert.equal(fingerprintCheckout(first), fingerprintCheckout(reordered));

  for (const changed of [
    snapshot({ basket: [{ ...first.basket[0], quantity: "3" }] }),
    snapshot({ deliverTo: "Different address" }),
    snapshot({ paymentMethod: "Cash on Delivery" }),
    snapshot({ deliverySelection: ["Friday 18:00–20:00"] }),
    snapshot({ feeSummary: ["Subtotal $7.00", "Shipping $2.99"] }),
    snapshot({ total: 10.09, totalBlock: "Total $10.09" }),
  ]) {
    assert.notEqual(fingerprintCheckout(first), fingerprintCheckout(changed));
  }
});

test("review tokens expire, are single-use, and a new review revokes the old token", () => {
  let now = 1_000;
  let serial = 0;
  const store = new ReviewTokenStore(
    100,
    () => now,
    () => `token-${++serial}`,
  );
  const first = store.issue(snapshot());
  assert.equal(store.size, 1);
  assert.equal(store.consume(first.token).reviewedTotal, 9.09);
  assert.equal(store.size, 0);
  assert.throws(() => store.consume(first.token), /already been used/);

  const old = store.issue(snapshot());
  const current = store.issue(snapshot());
  assert.throws(() => store.consume(old.token), /invalid/);
  assert.equal(store.consume(current.token).reviewedTotal, 9.09);

  const expiring = store.issue(snapshot());
  now = expiring.expiresAt;
  assert.throws(() => store.consume(expiring.token), /expired/);
  assert.equal(store.size, 0);
});

test("order request validation keeps the confirmation, total ceiling, and tolerance guards", () => {
  const valid = { confirm: true, expectedTotal: 9.09, reviewToken: "review" };
  assert.deepEqual(validateOrderRequest(valid, 300), { tolerance: 0 });
  assert.deepEqual(validateOrderRequest({ ...valid, tolerance: 0 }, 300), {
    tolerance: 0,
  });
  assert.throws(
    () => validateOrderRequest({ ...valid, confirm: false }, 300),
    /confirm was not true/,
  );
  assert.throws(
    () => validateOrderRequest({ ...valid, expectedTotal: 0 }, 300),
    /positive/,
  );
  assert.throws(
    () => validateOrderRequest({ ...valid, expectedTotal: 301 }, 300),
    /configured ceiling/,
  );
  assert.throws(
    () => validateOrderRequest({ ...valid, tolerance: 5.01 }, 300),
    /between 0 and 0.5/,
  );
  assert.throws(
    () => validateOrderRequest({ ...valid, reviewToken: "" }, 300),
    /review_token is required/,
  );
});

test("a consumed grant authorizes only the exact reviewed checkout", () => {
  const reviewed = snapshot();
  const store = new ReviewTokenStore(
    1_000,
    () => 5_000,
    () => "exact-review-token",
  );
  const grant = store.consume(store.issue(reviewed).token);

  assert.doesNotThrow(() =>
    assertReviewedCheckoutMatches({
      grant,
      liveSnapshot: reviewed,
      expectedTotal: 9.09,
      tolerance: 0.5,
      currentUrl: "https://checkout.lazada.sg/shipping",
    }),
  );
  assert.throws(
    () =>
      assertReviewedCheckoutMatches({
        grant,
        liveSnapshot: reviewed,
        expectedTotal: 9,
        tolerance: 0.5,
        currentUrl: "https://checkout.lazada.sg/shipping",
      }),
    /does not equal the reviewed total/,
  );
  assert.throws(
    () =>
      assertReviewedCheckoutMatches({
        grant,
        liveSnapshot: snapshot({ deliverTo: "Changed" }),
        expectedTotal: 9.09,
        tolerance: 0.5,
        currentUrl: "https://checkout.lazada.sg/shipping",
      }),
    /changed after review/,
  );
  assert.throws(
    () =>
      assertReviewedCheckoutMatches({
        grant,
        liveSnapshot: reviewed,
        expectedTotal: 9.09,
        tolerance: 0.5,
        currentUrl: "https://www.lazada.sg/",
      }),
    /Not on the Lazada checkout page/,
  );
});
