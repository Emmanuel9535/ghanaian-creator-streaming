const PAYSTACK_API = "https://api.paystack.co";

export class PaystackConfigurationError extends Error {}

function secretKey() {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key || !key.startsWith("sk_test_")) {
    throw new PaystackConfigurationError("Paystack test mode is not configured. Add a sk_test_ secret key on the server.");
  }
  if (process.env.PAYSTACK_TEST_MODE !== "true") {
    throw new PaystackConfigurationError("Paystack live mode is disabled for this stage.");
  }
  return key;
}

async function paystackRequest<T>(path: string, init: RequestInit = {}) {
  const response = await fetch(`${PAYSTACK_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${secretKey()}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    cache: "no-store",
  });
  const payload = await response.json() as { status?: boolean; message?: string; data?: T };
  if (!response.ok || payload.status !== true || payload.data === undefined) {
    throw new Error(payload.message || `Paystack request failed with HTTP ${response.status}.`);
  }
  return payload.data;
}

export type PaystackTransaction = {
  id: number;
  status: string;
  reference: string;
  amount: number;
  currency: string;
  gateway_response?: string;
  paid_at?: string | null;
};

export type PaystackInitializeResponse = {
  authorization_url: string;
  access_code: string;
  reference: string;
};

export async function initializeTransaction(input: { email: string; amount: number; reference: string; callback_url: string; metadata: Record<string, unknown> }) {
  return paystackRequest<PaystackInitializeResponse>("/transaction/initialize", { method: "POST", body: JSON.stringify({ ...input, amount: String(input.amount), currency: "GHS" }) });
}

export async function verifyTransaction(reference: string) {
  return paystackRequest<PaystackTransaction>(`/transaction/verify/${encodeURIComponent(reference)}`);
}
