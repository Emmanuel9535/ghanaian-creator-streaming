export type FloatMovementKind = "DEPOSIT" | "WITHDRAWAL" | "ADJUSTMENT" | "TRANSFER";

export type QueuedFloatMovement = {
  requestId: string;
  businessId: string;
  boothId: string;
  accountId: string;
  destinationAccountId?: string | null;
  movementType: FloatMovementKind;
  amountPesewas: number;
  description: string;
  queuedAt: string;
};

const STORAGE_KEY = "momo-ledger.float-movement-queue.v1";

function readQueue(): QueuedFloatMovement[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: QueuedFloatMovement[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  window.dispatchEvent(new Event("float-queue-changed"));
}

export function getFloatQueue() {
  return readQueue();
}

export function enqueueFloatMovement(movement: Omit<QueuedFloatMovement, "queuedAt">) {
  const queue = readQueue();
  if (!queue.some((item) => item.requestId === movement.requestId)) {
    writeQueue([...queue, { ...movement, queuedAt: new Date().toISOString() }]);
  }
  return getFloatQueue();
}

export async function flushFloatQueue(supabase: { rpc: (name: string, args: Record<string, unknown>) => any }) {
  const queue = readQueue();
  if (!queue.length || typeof navigator !== "undefined" && !navigator.onLine) return { synced: 0, failed: 0 };
  let synced = 0;
  let failed = 0;
  const remaining: QueuedFloatMovement[] = [];
  for (const item of queue) {
    const { error } = await supabase.rpc("record_float_movement", {
      target_business_id: item.businessId,
      target_booth_id: item.boothId,
      target_account_id: item.accountId,
      target_movement_type: item.movementType,
      target_amount_pesewas: item.amountPesewas,
      target_description: item.description || null,
      request_id: item.requestId,
      target_destination_account_id: item.destinationAccountId || null,
    });
    if (error) {
      failed += 1;
      remaining.push(item);
    } else {
      synced += 1;
    }
  }
  writeQueue(remaining);
  return { synced, failed };
}

export function newFloatRequestId() {
  return `float-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}
