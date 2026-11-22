export const NETWORKS = [
  { value: "MTN", label: "MTN Mobile Money" },
  { value: "TELECEL", label: "Telecel Cash" },
  { value: "AT", label: "AT Money" },
] as const;
export const TYPES = [
  { value: "DEPOSIT", label: "Deposit", icon: "↓", description: "Customer sends money" },
  { value: "WITHDRAWAL", label: "Withdrawal", icon: "↑", description: "Pay cash to customer" },
  { value: "AIRTIME", label: "Airtime", icon: "◉", description: "Record airtime purchase" },
  { value: "BILL_PAYMENT", label: "Bill payment", icon: "▣", description: "Record a bill payment" },
] as const;
export const STATUSES = ["PENDING", "SUCCESSFUL", "FAILED", "REVERSED"] as const;
export type TransactionType = typeof TYPES[number]["value"];
export type Network = typeof NETWORKS[number]["value"];

export function normalizeGhanaPhone(value: string) {
  const raw = value.trim().replace(/[\s()-]/g, "");
  if (raw.startsWith("+233")) return `0${raw.slice(4)}`;
  if (raw.startsWith("233")) return `0${raw.slice(3)}`;
  return raw;
}
export function isValidGhanaPhone(value: string) {
  return /^(02|05)\d{8}$/.test(normalizeGhanaPhone(value));
}
export function parsePesewas(value: string) {
  const trimmed = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const [cedis, fraction = ""] = trimmed.split(".");
  const pesewas = Number(`${cedis}${fraction.padEnd(2, "0")}`);
  return Number.isSafeInteger(pesewas) && pesewas > 0 ? pesewas : null;
}
export function gh(pesewas: number | null | undefined) { return `GH₵ ${(Number(pesewas ?? 0) / 100).toFixed(2)}`; }
export function maskPhone(value: string) { const n = normalizeGhanaPhone(value); return n.length >= 10 ? `${n.slice(0, 3)}••••${n.slice(-3)}` : "••••"; }
export function typeLabel(value: string) { return TYPES.find((item) => item.value === value)?.label ?? value; }
export function networkLabel(value: string) { return NETWORKS.find((item) => item.value === value)?.label ?? value; }
