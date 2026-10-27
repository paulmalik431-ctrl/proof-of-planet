// Fees and posting recipes. "We earn from fees, not from ECOIN's price."
// Every fee splits between ECO's treasury (revenue) and the Reserve, which builds an audited
// backing for ECOIN that anyone can see on the public ledger.
import { type Leg, SYSTEM } from "./ledger.ts";

export const FEES = {
  marketplaceBps: 200, // Loop marketplace fee, paid by the seller on release (2%)
  escrowBps: 100,      // Loop escrow fee, paid by the seller on release (1%)
  paymentBps: 100,     // Glance payment fee, paid by the shop (1%)
  reserveShare: 0.3,   // share of every fee that goes to the Reserve
} as const;

export interface FeeSplit { fee: number; treasury: number; reserve: number; net: number }

export function split(amount: number, bps: number): FeeSplit {
  const fee = Math.floor((amount * bps) / 10_000);
  const reserve = Math.floor(fee * FEES.reserveShare);
  return { fee, treasury: fee - reserve, reserve, net: amount - fee };
}

const nz = (legs: Leg[]) => legs.filter((l) => l.amount !== 0);

/** Loop step 1: the buyer's ECOIN is locked in escrow as collateral. */
export function escrowLock(buyer: string, total: number): Leg[] {
  return [{ account_id: buyer, amount: -total, kind: "escrow" }, { account_id: SYSTEM.escrow, amount: total, kind: "escrow" }];
}

/** Loop step 2a: delivery confirmed — escrow pays the seller, minus marketplace + escrow fees. */
export function escrowRelease(seller: string, total: number): { legs: Leg[]; split: FeeSplit } {
  const s = split(total, FEES.marketplaceBps + FEES.escrowBps);
  return {
    split: s,
    legs: nz([
      { account_id: SYSTEM.escrow, amount: -total, kind: "trade" },
      { account_id: seller, amount: s.net, kind: "trade" },
      { account_id: SYSTEM.treasury, amount: s.treasury, kind: "fee" },
      { account_id: SYSTEM.reserve, amount: s.reserve, kind: "reserve" },
    ]),
  };
}

/** Loop step 2b: refund to the buyer (dispute decided for the buyer, or trade cancelled). No fee. */
export function escrowRefund(buyer: string, total: number): Leg[] {
  return [{ account_id: SYSTEM.escrow, amount: -total, kind: "escrow" }, { account_id: buyer, amount: total, kind: "escrow" }];
}

/** Partial settlement after a dispute: part to the seller (with fees), the rest back to the buyer. */
export function escrowSplit(seller: string, buyer: string, total: number, toSeller: number): { legs: Leg[]; split: FeeSplit } {
  const s = split(toSeller, FEES.marketplaceBps + FEES.escrowBps);
  return {
    split: s,
    legs: nz([
      { account_id: SYSTEM.escrow, amount: -total, kind: "trade" },
      { account_id: seller, amount: s.net, kind: "trade" },
      { account_id: buyer, amount: total - toSeller, kind: "trade" },
      { account_id: SYSTEM.treasury, amount: s.treasury, kind: "fee" },
      { account_id: SYSTEM.reserve, amount: s.reserve, kind: "reserve" },
    ]),
  };
}

/** Glance: customer pays a shop; the shop pays the payment fee. */
export function payment(customer: string, shop: string, amount: number): { legs: Leg[]; split: FeeSplit } {
  const s = split(amount, FEES.paymentBps);
  return {
    split: s,
    legs: nz([
      { account_id: customer, amount: -amount, kind: "payment" },
      { account_id: shop, amount: s.net, kind: "payment" },
      { account_id: SYSTEM.treasury, amount: s.treasury, kind: "fee" },
      { account_id: SYSTEM.reserve, amount: s.reserve, kind: "reserve" },
    ]),
  };
}
