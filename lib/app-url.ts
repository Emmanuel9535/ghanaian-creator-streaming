export const STABLE_APP_URL = "https://momo-ledger-ghana-first-streaming-network.vercel.app";

/**
 * Authentication links must point to the deployed app, not the browser origin.
 * A user may register from localhost during development, but the email is
 * opened later on a device where localhost refers to that device itself.
 */
export function getAppUrl() {
  return STABLE_APP_URL;
}
