import assert from "node:assert/strict";
import test from "node:test";

import { isCheckoutUrl, validateLazadaUrl } from "../dist/url-policy.js";

test("accepts canonical Lazada Singapore URLs and removes fragments", () => {
  assert.equal(
    validateLazadaUrl(
      "https://www.lazada.sg/products/oat-milk-i123-s456.html#reviews",
      "product",
    ),
    "https://www.lazada.sg/products/oat-milk-i123-s456.html",
  );
  assert.equal(
    validateLazadaUrl("https://cart.lazada.sg/cart?from=header", "probe"),
    "https://cart.lazada.sg/cart?from=header",
  );
  assert.equal(
    validateLazadaUrl("https://www.lazada.sg/", "base"),
    "https://www.lazada.sg/",
  );
});

test("rejects SSRF-shaped and deceptive URLs", () => {
  const rejected = [
    "http://www.lazada.sg/products/x-i1.html",
    "https://user:pass@www.lazada.sg/products/x-i1.html",
    "https://www.lazada.sg:8443/products/x-i1.html",
    "https://localhost/products/x-i1.html",
    "https://127.0.0.1/products/x-i1.html",
    "https://10.0.0.1/products/x-i1.html",
    "https://192.168.1.1/products/x-i1.html",
    "https://[::1]/products/x-i1.html",
    "https://evil.example/products/x-i1.html",
    "https://www.lazada.sg.evil.example/products/x-i1.html",
    "https://lazada.sg@evil.example/products/x-i1.html",
  ];
  for (const url of rejected) {
    assert.throws(() => validateLazadaUrl(url, "product"), undefined, url);
  }
});

test("product and base purposes apply narrower policy", () => {
  assert.throws(
    () => validateLazadaUrl("https://www.lazada.sg/catalog/?q=milk", "product"),
    /not a Lazada product page/,
  );
  assert.throws(
    () => validateLazadaUrl("https://cart.lazada.sg/cart", "product"),
    /not allowed/,
  );
  assert.throws(
    () => validateLazadaUrl("https://lazada.sg/", "base"),
    /not allowed/,
  );
  assert.throws(
    () => validateLazadaUrl("https://www.lazada.sg/catalog", "base"),
    /must be exactly/,
  );
  assert.throws(
    () => validateLazadaUrl("https://www.lazada.sg/?next=cart", "base"),
    /must be exactly/,
  );
});

test("checkout recognition is exact", () => {
  assert.equal(isCheckoutUrl("https://checkout.lazada.sg/shipping"), true);
  assert.equal(
    isCheckoutUrl("https://checkout.lazada.sg.evil.example/shipping"),
    false,
  );
  assert.equal(isCheckoutUrl("http://checkout.lazada.sg/shipping"), false);
  assert.equal(isCheckoutUrl("https://checkout.lazada.sg:444/shipping"), false);
});
