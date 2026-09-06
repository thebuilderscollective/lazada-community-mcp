import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { isCheckoutUrl } from "./url-policy.js";

export type CheckoutItemSnapshot = {
  identity: string | null;
  quantity: string;
  summary: string;
};

export type CheckoutReviewSnapshot = {
  basket: CheckoutItemSnapshot[];
  deliverTo: string | null;
  paymentMethod: string | null;
  deliverySelection: string[];
  feeSummary: string[];
  totalBlock: string;
  total: number;
  currency: "SGD";
};

export type ReviewGrant = {
  fingerprint: string;
  reviewedTotal: number;
  issuedAt: number;
  expiresAt: number;
};

export type ReviewToken = {
  token: string;
  expiresAt: number;
};

export type OrderRequest = {
  confirm: boolean;
  expectedTotal: number;
  tolerance?: number;
  reviewToken: string;
};

export const DEFAULT_REVIEW_TOKEN_TTL_MS = 5 * 60_000;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function fingerprintCheckout(snapshot: CheckoutReviewSnapshot): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(snapshot)))
    .digest("hex");
}

/**
 * Tokens are opaque capabilities kept only in this server process. Issuing a
 * new token revokes every older review; consuming one deletes it before any
 * browser action, so retries must always begin with a fresh review.
 */
export class ReviewTokenStore {
  private grants = new Map<string, ReviewGrant>();

  constructor(
    private readonly ttlMs = DEFAULT_REVIEW_TOKEN_TTL_MS,
    private readonly now: () => number = Date.now,
    private readonly makeToken: () => string = () =>
      randomBytes(32).toString("base64url"),
  ) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new Error(
        "Review token TTL must be a positive number of milliseconds.",
      );
    }
  }

  issue(snapshot: CheckoutReviewSnapshot): ReviewToken {
    this.grants.clear();
    const issuedAt = this.now();
    const expiresAt = issuedAt + this.ttlMs;
    const token = this.makeToken();
    this.grants.set(token, {
      fingerprint: fingerprintCheckout(snapshot),
      reviewedTotal: snapshot.total,
      issuedAt,
      expiresAt,
    });
    return { token, expiresAt };
  }

  consume(token: string): ReviewGrant {
    const grant = this.grants.get(token);
    if (grant) this.grants.delete(token);
    if (!grant) {
      throw new Error(
        "review_token is invalid or has already been used. Run review_checkout again; nothing was ordered.",
      );
    }
    if (this.now() >= grant.expiresAt) {
      throw new Error(
        "review_token expired. Run review_checkout again; nothing was ordered.",
      );
    }
    return grant;
  }

  invalidate(): void {
    this.grants.clear();
  }

  get size(): number {
    return this.grants.size;
  }
}

export function validateOrderRequest(
  args: OrderRequest,
  maxOrderTotal: number,
): { tolerance: number } {
  if (!args.confirm) {
    throw new Error("confirm was not true; nothing was ordered.");
  }
  if (!(args.expectedTotal > 0) || !Number.isFinite(args.expectedTotal)) {
    throw new Error(
      "expected_total must be a positive number matching the reviewed checkout total.",
    );
  }
  if (args.expectedTotal > maxOrderTotal) {
    throw new Error(
      `expected_total ${args.expectedTotal} exceeds the configured ceiling of ${maxOrderTotal} SGD. ` +
        "Raise LAZADA_MAX_ORDER_TOTAL deliberately if intended. Nothing was ordered.",
    );
  }
  const tolerance = args.tolerance ?? 0;
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 0.5) {
    throw new Error(
      "tolerance must be between 0 and 0.5 SGD. Nothing was ordered.",
    );
  }
  if (!args.reviewToken) {
    throw new Error(
      "review_token is required. Run review_checkout again; nothing was ordered.",
    );
  }
  return { tolerance };
}

function hashesEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function assertReviewedCheckoutMatches(args: {
  grant: ReviewGrant;
  liveSnapshot: CheckoutReviewSnapshot;
  expectedTotal: number;
  tolerance: number;
  currentUrl: string;
}): void {
  if (!isCheckoutUrl(args.currentUrl)) {
    throw new Error(
      `Not on the Lazada checkout page (currently ${args.currentUrl}). Run review_checkout immediately ` +
        "before place_order. Nothing was ordered.",
    );
  }
  if (args.liveSnapshot.basket.length === 0) {
    throw new Error("The checkout page lists no items. Nothing was ordered.");
  }
  if (Math.abs(args.expectedTotal - args.grant.reviewedTotal) > 0.005) {
    throw new Error(
      `expected_total ${args.expectedTotal} does not equal the reviewed total ${args.grant.reviewedTotal} SGD. ` +
        "Run review_checkout again. Nothing was ordered.",
    );
  }
  const liveFingerprint = fingerprintCheckout(args.liveSnapshot);
  if (!hashesEqual(liveFingerprint, args.grant.fingerprint)) {
    throw new Error(
      "The basket, delivery selection, address, fees, payment method, or total changed after review. " +
        "Run review_checkout again and ask the user to approve the new summary. Nothing was ordered.",
    );
  }
  if (Math.abs(args.liveSnapshot.total - args.expectedTotal) > args.tolerance) {
    throw new Error(
      `Checkout total is ${args.liveSnapshot.total} SGD but expected_total was ${args.expectedTotal} ` +
        `(tolerance ${args.tolerance}). Run review_checkout again. Nothing was ordered.`,
    );
  }
}
