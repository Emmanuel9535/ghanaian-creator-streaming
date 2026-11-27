export const CANONICAL_APP_URL = "https://momo-ledger-ojiit6tsz-ghana-first-streaming-network.vercel.app";

/** Authentication links must point to the exact deployed app, not localhost or the browser origin. */
export function getAppUrl() {
  return CANONICAL_APP_URL;
}
