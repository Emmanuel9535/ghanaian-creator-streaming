"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Clipboard, ExternalLink, Save, Send, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { resolveActiveWorkspace } from "@/lib/workspace";
import {
  gh,
  isValidGhanaPhone,
  NETWORKS,
  normalizeGhanaPhone,
  parsePesewas,
  STATUSES,
  TYPES,
  type TransactionType,
} from "@/lib/transactions";

type CaptureStatus = "DRAFT" | "AWAITING_PROCESSING" | "PROCESSING" | "SUCCESSFUL" | "FAILED" | "CANCELLED";
type FormState = {
  network: string;
  phone: string;
  amount: string;
  charge: string;
  provider: string;
  name: string;
  notes: string;
  billCategory: string;
  account: string;
  status: CaptureStatus;
  when: string;
};
type ServerDraft = {
  id: string;
  transaction_number: number;
  internal_reference: string;
  transaction_type: string;
  principal_amount_pesewas: number;
  transaction_at: string;
};
type PendingPosting = { id: string; reference: string; requestId: string };
type DeviceDraft = { type?: string; form?: Partial<FormState>; editingId?: string | null; pendingPosting?: PendingPosting | null; recoveredAt?: number };

function decodeDeviceDrafts(raw: string): DeviceDraft[] {
  try {
    const value = JSON.parse(raw) as unknown;
    if (Array.isArray(value)) return value as DeviceDraft[];
    if (value && typeof value === "object") return [value as DeviceDraft];
  } catch { /* invalid local recovery data is ignored */ }
  return [];
}

const CAPTURE_STATUSES: CaptureStatus[] = ["DRAFT", "AWAITING_PROCESSING", "PROCESSING", "SUCCESSFUL", "FAILED", "CANCELLED"];
const initial = (): FormState => ({
  network: "MTN",
  phone: "",
  amount: "",
  charge: "",
  provider: "",
  name: "",
  notes: "",
  billCategory: "Electricity",
  account: "",
  status: "AWAITING_PROCESSING",
  when: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16),
});

function NewTransactionExperience() {
  const supabase = useMemo(() => createClient(), []);
  const searchParams = useSearchParams();
  const [type, setType] = useState<TransactionType>("DEPOSIT");
  const [form, setForm] = useState<FormState>(initial);
  const [userId, setUserId] = useState<string | null>(null);
  const [business, setBusiness] = useState<{ id: string; name: string; setup_status: string } | null>(null);
  const [booth, setBooth] = useState<{ id: string; name: string; location: string } | null>(null);
  const [role, setRole] = useState<"OWNER" | "ATTENDANT" | null>(null);
  const [savedDrafts, setSavedDrafts] = useState<ServerDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [postingRetry, setPostingRetry] = useState(false);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [localSaved, setLocalSaved] = useState(false);
  const [localRecoveryCount, setLocalRecoveryCount] = useState(0);
  const [isDirty, setIsDirty] = useState(false);
  const [pendingPosting, setPendingPosting] = useState<PendingPosting | null>(null);
  const [message, setMessage] = useState<{ kind: "error" | "success" | "info"; text: string } | null>(null);

  const localKey = userId && business?.id ? `momo-ledger.transaction-draft.${userId}.${business.id}` : null;
  const recoveryKey = localKey ? `${localKey}.recovery` : null;
  const draftPayload = useMemo(
    () => JSON.stringify({ type, form, editingId, pendingPosting }),
    [type, form, editingId, pendingPosting],
  );

  useEffect(() => {
    let cancelled = false;
    async function loadWorkspace() {
      setLoading(true);
      if (!supabase) {
        if (!cancelled) {
          setWorkspaceError("Secure workspace access is not configured. Contact the workspace owner.");
          setDraftHydrated(true);
          setLoading(false);
        }
        return;
      }

      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (cancelled) return;
      if (userError || !user) {
        setWorkspaceError("Your session is not active. Please log in to open transaction capture.");
        setDraftHydrated(true);
        setLoading(false);
        return;
      }

      setUserId(user.id);
      const resolution = await resolveActiveWorkspace(supabase, user.id);
      if (cancelled) return;
      if (resolution.error) {
        setWorkspaceError(`Workspace access could not be checked: ${resolution.error}`);
        setDraftHydrated(true);
        setLoading(false);
        return;
      }
      if (!resolution.workspace) {
        setWorkspaceError(resolution.activeMembershipCount === 0
          ? "No active business membership is available for this account. Ask the business owner to restore access, or complete setup if you are the owner."
          : "Your active membership does not currently include a business workspace. Ask the business owner to check the workspace assignment.");
        setDraftHydrated(true);
        setLoading(false);
        return;
      }

      const resolved = resolution.workspace;
      setBusiness(resolved.business);
      setBooth(resolved.booth);
      setRole(resolved.role);

      if (resolved.business.setup_status === "complete" && resolved.booth) {
        const { data: drafts, error: draftsError } = await supabase
          .from("transactions")
          .select("id,transaction_number,internal_reference,transaction_type,principal_amount_pesewas,transaction_at")
          .eq("business_id", resolved.business.id)
          .eq("transaction_status", "DRAFT")
          .order("created_at", { ascending: false })
          .limit(8);
        if (!cancelled) {
          if (draftsError) setMessage({ kind: "error", text: `Saved drafts could not be loaded: ${draftsError.message}` });
          setSavedDrafts((drafts ?? []) as ServerDraft[]);
        }

        try {
          const storageKey = `momo-ledger.transaction-draft.${user.id}.${resolved.business.id}`;
          const recovered = window.localStorage.getItem(`${storageKey}.recovery`);
          setLocalRecoveryCount(recovered ? decodeDeviceDrafts(recovered).length : 0);
          const stored = window.localStorage.getItem(storageKey);
          if (stored && !cancelled) {
            const value = JSON.parse(stored) as {
              type?: string;
              form?: Partial<FormState>;
              editingId?: string | null;
              pendingPosting?: PendingPosting | null;
            };
            const savedType = TYPES.find((item) => item.value === value.type)?.value;
            if (savedType) setType(savedType);
            if (value.form && !value.pendingPosting) setForm({ ...initial(), ...value.form });
            if (value.editingId) setEditingId(value.editingId);
            if (value.pendingPosting) {
              setPendingPosting(value.pendingPosting);
              setForm(initial());
              setEditingId(null);
              setMessage({ kind: "info", text: "A successful transaction needs its ledger posting retried. Do not create a duplicate transaction." });
            } else {
              setIsDirty(true);
              setMessage({ kind: "info", text: "Your unfinished entry was recovered from this device." });
            }
            setLocalSaved(true);
          }
        } catch {
          try { window.localStorage.removeItem(`momo-ledger.transaction-draft.${user.id}.${resolved.business.id}`); } catch { /* storage may be unavailable */ }
        }
      }
      if (!cancelled) {
        setDraftHydrated(true);
        setLoading(false);
      }
    }
    void loadWorkspace();
    return () => { cancelled = true; };
  }, [supabase]);

  useEffect(() => {
    if (!draftHydrated || loading || !isDirty || !localKey) return;
    try {
      window.localStorage.setItem(localKey, draftPayload);
      setLocalSaved(true);
    } catch {
      setMessage({ kind: "error", text: "This browser could not save a recovery draft. Use Save draft to keep it in your workspace." });
    }
  }, [draftPayload, draftHydrated, isDirty, loading, localKey]);

  useEffect(() => {
    const draftId = searchParams.get("draft");
    if (!draftId || loading || !supabase || !business || !booth || pendingPosting) return;
    const client = supabase;
    let cancelled = false;
    async function openServerDraft() {
      const { data, error } = await client
        .from("transactions")
        .select("id,business_id,transaction_type,network,customer_phone,principal_amount_pesewas,customer_charge_pesewas,provider_reference,customer_name_snapshot,notes,transaction_at,bill_category,customer_account_reference,transaction_status")
        .eq("id", draftId)
        .eq("business_id", business!.id)
        .eq("transaction_status", "DRAFT")
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setMessage({ kind: "error", text: error?.message ?? "That saved draft is no longer available in this workspace." });
        return;
      }
      const storageKey = `momo-ledger.transaction-draft.${userId}.${business!.id}`;
      const storedLocal = window.localStorage.getItem(storageKey);
      if (storedLocal) {
        try {
          const localDraft = JSON.parse(storedLocal) as DeviceDraft;
          const localForm = localDraft.form ?? {};
          const hasLocalWork = Boolean(localDraft.editingId)
            || Boolean(localDraft.type && localDraft.type !== "DEPOSIT")
            || Boolean(localForm.phone?.trim() || localForm.amount?.trim() || localForm.name?.trim() || localForm.charge?.trim() || localForm.provider?.trim() || localForm.notes?.trim() || localForm.account?.trim())
            || (localForm.billCategory !== undefined && localForm.billCategory !== "Electricity")
            || (localForm.when !== undefined && localForm.when !== initial().when)
            || (localForm.network !== undefined && localForm.network !== "MTN")
            || (localForm.status !== undefined && localForm.status !== "AWAITING_PROCESSING");
          if (localDraft.editingId === data.id && localDraft.form && !localDraft.pendingPosting) {
            setMessage({ kind: "info", text: "The newer device-recovered edits for this draft were kept instead of replacing them with the older saved copy." });
            return;
          }
          if (hasLocalWork && !localDraft.pendingPosting) {
            const snapshots = decodeDeviceDrafts(window.localStorage.getItem(`${storageKey}.recovery`) ?? "[]");
            snapshots.push({ ...localDraft, recoveredAt: Date.now() });
            const retained = snapshots.slice(-10);
            window.localStorage.setItem(`${storageKey}.recovery`, JSON.stringify(retained));
            setLocalRecoveryCount(retained.length);
          }
        } catch {
          setMessage({ kind: "error", text: "The local draft could not be preserved, so the saved workspace draft was not opened. Do not refresh; copy your local values first." });
          return;
        }
      }
      setEditingId(data.id);
      setType((TYPES.find((item) => item.value === data.transaction_type)?.value ?? "DEPOSIT") as TransactionType);
      setForm({
        network: data.network,
        phone: data.customer_phone,
        amount: (Number(data.principal_amount_pesewas) / 100).toFixed(2),
        charge: (Number(data.customer_charge_pesewas) / 100).toFixed(2),
        provider: data.provider_reference ?? "",
        name: data.customer_name_snapshot ?? "",
        notes: data.notes ?? "",
        billCategory: data.bill_category ?? "Electricity",
        account: data.customer_account_reference ?? "",
        status: "DRAFT",
        when: new Date(data.transaction_at).toISOString().slice(0, 16),
      });
      setIsDirty(true);
      setMessage({ kind: "info", text: "Saved workspace draft reopened for editing." });
    }
    void openServerDraft();
    return () => { cancelled = true; };
  }, [searchParams, supabase, loading, business, booth, pendingPosting, userId]);

  function change(key: keyof FormState, value: string) {
    setForm((old) => ({ ...old, [key]: value }));
    setIsDirty(true);
    setMessage(null);
  }

  async function copyPhone() {
    if (!form.phone) return;
    try {
      await navigator.clipboard.writeText(normalizeGhanaPhone(form.phone));
      setMessage({ kind: "info", text: "Phone number copied." });
    } catch {
      setMessage({ kind: "error", text: "Clipboard access is unavailable. Select and copy the phone number manually." });
    }
  }

  function restoreDeviceDraft() {
    if (pendingPosting) {
      setMessage({ kind: "error", text: "Retry the saved ledger posting before restoring another device draft." });
      return;
    }
    if (!recoveryKey) return;
    const snapshots = decodeDeviceDrafts(window.localStorage.getItem(recoveryKey) ?? "[]");
    const snapshot = snapshots.pop();
    if (!snapshot) {
      window.localStorage.removeItem(recoveryKey);
      setLocalRecoveryCount(0);
      return;
    }
    if (snapshots.length) window.localStorage.setItem(recoveryKey, JSON.stringify(snapshots));
    else window.localStorage.removeItem(recoveryKey);
    setLocalRecoveryCount(snapshots.length);
    const savedType = TYPES.find((item) => item.value === snapshot.type)?.value;
    if (savedType) setType(savedType);
    setForm(snapshot.pendingPosting ? initial() : { ...initial(), ...snapshot.form });
    setEditingId(snapshot.pendingPosting ? null : snapshot.editingId ?? null);
    setPendingPosting(snapshot.pendingPosting ?? null);
    setIsDirty(!snapshot.pendingPosting);
    setLocalSaved(true);
    setMessage({ kind: "info", text: snapshot.pendingPosting ? "The saved ledger retry was restored on this device." : "The previous device draft was restored. Save it to the workspace when ready." });
  }

  function validate() {
    const phone = normalizeGhanaPhone(form.phone);
    const amount = parsePesewas(form.amount);
    const charge = form.charge.trim() === "" ? 0 : parsePesewas(form.charge);
    if (!isValidGhanaPhone(phone)) return "Enter a valid Ghanaian mobile number.";
    if (!amount) return "Enter an amount greater than GH₵0.00.";
    if (charge === null) return "Service charge must be a valid amount.";
    if (!CAPTURE_STATUSES.includes(form.status)) return "Choose a valid transaction status.";
    if (Number.isNaN(new Date(form.when).getTime())) return "Enter a valid transaction date and time.";
    if (type === "BILL_PAYMENT" && (!form.billCategory || !form.account.trim())) return "Bill category and customer account or meter number are required.";
    return null;
  }

  async function retryLedgerPosting() {
    if (!supabase || !pendingPosting) return;
    setPostingRetry(true);
    const { error } = await supabase.rpc("post_momo_transaction", {
      target_transaction_id: pendingPosting.id,
      request_id: pendingPosting.requestId,
    });
    setPostingRetry(false);
    if (error) {
      setMessage({ kind: "error", text: `The same transaction is still saved, but ledger posting failed: ${error.message}` });
      return;
    }
    if (localKey) window.localStorage.removeItem(localKey);
    setPendingPosting(null);
    setLocalSaved(false);
    setMessage({ kind: "success", text: `Ledger posting completed for ${pendingPosting.reference}.` });
  }

  async function save(status: CaptureStatus) {
    setMessage(null);
    if (pendingPosting) {
      setMessage({ kind: "error", text: "Retry the saved ledger posting before creating another transaction." });
      return;
    }
    const validationError = validate();
    if (validationError) {
      setMessage({ kind: "error", text: validationError });
      return;
    }
    if (!supabase || !business || !booth || business.setup_status !== "complete") {
      setMessage({ kind: "error", text: "A completed business setup and active booth are required before recording a transaction." });
      return;
    }

    setSaving(true);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user || user.id !== userId) {
      setSaving(false);
      setMessage({ kind: "error", text: "Your session is no longer valid. Log in again before saving." });
      return;
    }

    const phone = normalizeGhanaPhone(form.phone);
    const amount = parsePesewas(form.amount)!;
    const charge = form.charge.trim() === "" ? 0 : parsePesewas(form.charge)!;
    let customerId: string | null = null;
    const existingCustomer = await supabase
      .from("customers")
      .select("id")
      .eq("business_id", business.id)
      .eq("phone_normalized", phone)
      .maybeSingle();

    if (existingCustomer.error) {
      setSaving(false);
      setMessage({ kind: "error", text: `Customer lookup failed: ${existingCustomer.error.message}` });
      return;
    }
    if (existingCustomer.data) {
      customerId = existingCustomer.data.id;
    } else {
      const createdCustomer = await supabase
        .from("customers")
        .insert({
          business_id: business.id,
          phone_normalized: phone,
          phone_display: form.phone.trim(),
          full_name: form.name.trim() || null,
        })
        .select("id")
        .single();
      if (createdCustomer.error?.code === "23505") {
        const duplicate = await supabase
          .from("customers")
          .select("id")
          .eq("business_id", business.id)
          .eq("phone_normalized", phone)
          .maybeSingle();
        if (duplicate.error || !duplicate.data) {
          setSaving(false);
          setMessage({ kind: "error", text: "A customer with that phone number already exists, but could not be linked. Refresh and try again." });
          return;
        }
        customerId = duplicate.data.id;
      } else if (createdCustomer.error || !createdCustomer.data) {
        setSaving(false);
        setMessage({ kind: "error", text: `Customer registration failed: ${createdCustomer.error?.message ?? "No customer record was returned."}` });
        return;
      } else {
        customerId = createdCustomer.data.id;
      }
    }

    const payload = {
      business_id: business.id,
      booth_id: booth.id,
      customer_id: customerId,
      attendant_id: user.id,
      network: form.network,
      transaction_type: type,
      principal_amount_pesewas: amount,
      customer_charge_pesewas: charge,
      provider_reference: form.provider.trim() || null,
      customer_phone: phone,
      customer_name_snapshot: form.name.trim() || null,
      bill_category: type === "BILL_PAYMENT" ? form.billCategory : null,
      customer_account_reference: type === "BILL_PAYMENT" ? form.account.trim() : null,
      transaction_status: status,
      confirmation_method: status === "SUCCESSFUL" ? "MANUALLY_CONFIRMED" : null,
      notes: form.notes.trim() || null,
      transaction_at: new Date(form.when).toISOString(),
    };

    const result = editingId
      ? await supabase.from("transactions").update(payload)
        .eq("id", editingId)
        .eq("business_id", business.id)
        .eq("transaction_status", "DRAFT")
        .select("id,internal_reference,transaction_number,idempotency_key")
        .single()
      : await supabase.from("transactions").insert(payload)
        .select("id,internal_reference,transaction_number,idempotency_key")
        .single();

    if (result.error || !result.data) {
      setSaving(false);
      setMessage({
        kind: "error",
        text: `The customer is registered, but the transaction was not saved: ${result.error?.message ?? "No transaction record was returned."}`,
      });
      return;
    }

    const transaction = result.data;
    let postingFailure: string | null = null;
    if (status === "SUCCESSFUL") {
      const posting = await supabase.rpc("post_momo_transaction", {
        target_transaction_id: transaction.id,
        request_id: transaction.idempotency_key,
      });
      if (posting.error) postingFailure = posting.error.message;
    }

    if (status === "DRAFT") {
      const updatedDraft: ServerDraft = {
        id: transaction.id,
        transaction_number: Number(transaction.transaction_number),
        internal_reference: transaction.internal_reference,
        transaction_type: type,
        principal_amount_pesewas: amount,
        transaction_at: payload.transaction_at,
      };
      setSavedDrafts((current) => [updatedDraft, ...current.filter((item) => item.id !== transaction.id)].slice(0, 8));
      setEditingId(transaction.id);
      setForm((current) => ({ ...current, status: "DRAFT" }));
      setIsDirty(false);
      if (localKey) window.localStorage.removeItem(localKey);
      setLocalSaved(false);
      setMessage({ kind: "success", text: "Draft saved securely to this business workspace." });
      setSaving(false);
      return;
    }

    setSavedDrafts((current) => current.filter((item) => item.id !== transaction.id));
    setForm({ ...initial(), network: form.network });
    setEditingId(null);
    setIsDirty(false);
    if (postingFailure) {
      const pending: PendingPosting = {
        id: transaction.id,
        reference: transaction.internal_reference,
        requestId: transaction.idempotency_key,
      };
      setPendingPosting(pending);
      setLocalSaved(true);
      if (localKey) {
        try {
          window.localStorage.setItem(localKey, JSON.stringify({ type, form: initial(), editingId: null, pendingPosting: pending }));
        } catch { /* the persisted transaction remains available in the workspace */ }
      }
      setMessage({ kind: "error", text: `Transaction ${transaction.internal_reference} is saved as successful, but its ledger posting failed: ${postingFailure}. Retry the posting below; do not enter it again.` });
    } else {
      if (localKey) window.localStorage.removeItem(localKey);
      setLocalSaved(false);
      setPendingPosting(null);
      setMessage({ kind: "success", text: status === "SUCCESSFUL"
        ? `Transaction ${transaction.internal_reference} was saved and posted through the ledger workflow.`
        : `Transaction ${transaction.internal_reference} was saved. Return after provider processing to record its outcome.` });
    }
    setSaving(false);
  }

  if (loading) return <div className="surface p-8 text-sm text-[var(--muted)]">Checking your secure business and booth access…</div>;
  if (!business || business.setup_status !== "complete" || !booth) {
    const setupIncomplete = Boolean(business) && (business?.setup_status !== "complete" || !booth);
    return <div className="surface max-w-xl p-6">
      <p className="eyebrow">Transaction capture</p>
      <h1 className="mt-2 text-2xl font-black text-[var(--teal-dark)]">{setupIncomplete ? "Workspace setup needs attention" : "Workspace access unavailable"}</h1>
      <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{workspaceError || (business?.setup_status !== "complete"
        ? "Business onboarding is not marked complete yet. Finish the required business, booth and opening-balance steps before recording transactions."
        : "An active booth is required for transaction capture. Access is checked through your existing business membership and database policies.")}</p>
      {setupIncomplete && role === "OWNER"
        ? <Link href="/setup" className="primary-button mt-6">Continue secure setup</Link>
        : <Link href="/dashboard" className="secondary-button mt-6">Return to workspace</Link>}
    </div>;
  }

  const amount = parsePesewas(form.amount) ?? 0;
  const charge = form.charge.trim() === "" ? 0 : parsePesewas(form.charge) ?? 0;

  return <div className="mx-auto max-w-4xl space-y-6">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><p className="eyebrow">{business.name} · {booth.name}</p><h1 className="page-title">New transaction</h1><p className="page-subtitle">Record the customer request, process it through the provider, then save the confirmed outcome.</p></div>
      <Link href="/transactions" className="secondary-button">View records</Link>
    </div>

    {localSaved && <div className="flex flex-col justify-between gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900 sm:flex-row sm:items-center">
      <span>{pendingPosting ? "A ledger posting retry is saved on this device." : "Unfinished entry is saved on this device for recovery after navigation or app switching."}</span>
      {!pendingPosting && <button className="font-bold underline" onClick={() => {
        if (localKey) window.localStorage.removeItem(localKey);
        setForm(initial()); setType("DEPOSIT"); setEditingId(null); setIsDirty(false); setLocalSaved(false);
        setMessage({ kind: "info", text: "This device recovery draft was discarded. Any server draft remains in your workspace." });
      }}>Discard device draft</button>}
    </div>}
    {localRecoveryCount > 0 && !pendingPosting && <div className="flex flex-col justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 sm:flex-row sm:items-center"><span>{localRecoveryCount === 1 ? "A previous device draft was preserved while opening this workspace draft." : `${localRecoveryCount} previous device drafts were preserved while switching drafts.`}</span><button type="button" onClick={restoreDeviceDraft} className="font-bold underline">Restore most recent device draft</button></div>}
    {message && <div role="alert" className={`rounded-xl border p-4 text-sm ${message.kind === "error" ? "border-red-200 bg-red-50 text-red-800" : message.kind === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-sky-200 bg-sky-50 text-sky-800"}`}>{message.text}</div>}
    {pendingPosting && <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      <p className="font-black">Saved transaction · ledger posting needs retry</p>
      <p className="mt-1">Reference {pendingPosting.reference}. Retrying uses the same transaction and idempotency key; it will not create another transaction.</p>
      <button type="button" disabled={postingRetry} onClick={() => void retryLedgerPosting()} className="primary-button mt-3">{postingRetry ? "Retrying posting…" : "Retry ledger posting"}</button>
    </section>}

    <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
      <main className="space-y-5">
        <section aria-label="Transaction type" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {TYPES.filter((item) => ["DEPOSIT", "WITHDRAWAL", "AIRTIME", "DATA_BUNDLE"].includes(item.value)).map((item) =>
            <button type="button" key={item.value} aria-pressed={type === item.value} onClick={() => { setType(item.value); setIsDirty(true); setMessage(null); }} className={`rounded-2xl border p-3 text-left ${type === item.value ? "border-[var(--teal)] bg-[#e8f4f7] shadow-sm" : "border-[var(--line)] bg-white hover:border-[#b8dce7]"}`}>
              <span className="text-xl font-black text-[var(--teal)]">{item.icon}</span><strong className="mt-2 block text-sm text-[var(--teal-dark)]">{item.label}</strong>
            </button>,
          )}
        </section>

        <section className="surface space-y-5 p-5 sm:p-7">
          <div className="flex items-center gap-2 border-b border-[var(--line)] pb-4"><ShieldCheck size={18} className="text-[var(--teal)]" /><div><h2 className="section-title">Customer request</h2><p className="text-xs text-[var(--muted)]">A customer record is matched or registered within this business when you save. <Link href="/customers" className="font-bold text-[var(--teal)] underline">Register without a transaction</Link></p></div></div>
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="field"><span>Network / provider</span><select value={form.network} onChange={(event) => change("network", event.target.value)}>{NETWORKS.map((network) => <option key={network.value} value={network.value}>{network.label}</option>)}</select></label>
            <label className="field"><span>Record status</span><select value={form.status} onChange={(event) => change("status", event.target.value)}>{STATUSES.filter((status) => CAPTURE_STATUSES.includes(status as CaptureStatus)).map((status) => <option key={status} value={status}>{status === "SUCCESSFUL" ? "Successful · manually confirmed" : status.replaceAll("_", " ")}</option>)}</select></label>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <label className="field"><span>Customer phone number</span><input required inputMode="tel" autoComplete="tel" placeholder="024 123 4567" value={form.phone} onChange={(event) => change("phone", event.target.value)} /></label>
            <button type="button" disabled={!form.phone} onClick={() => void copyPhone()} className="secondary-button self-end"><Clipboard size={16} /> Copy phone</button>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="field"><span>Amount (GH₵)</span><input required inputMode="decimal" placeholder="200.00" value={form.amount} onChange={(event) => change("amount", event.target.value)} /></label>
            <label className="field"><span>Customer name <em>optional</em></span><input autoComplete="name" value={form.name} onChange={(event) => change("name", event.target.value)} /></label>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="field"><span>Configured service charge (GH₵) <em>optional</em></span><input inputMode="decimal" placeholder="0.00" value={form.charge} onChange={(event) => change("charge", event.target.value)} /></label>
            <label className="field"><span>Provider reference <em>add after processing</em></span><input placeholder="External reference" value={form.provider} onChange={(event) => change("provider", event.target.value)} /></label>
          </div>
          {type === "BILL_PAYMENT" && <div className="grid gap-5 sm:grid-cols-2"><label className="field"><span>Bill category</span><input value={form.billCategory} onChange={(event) => change("billCategory", event.target.value)} /></label><label className="field"><span>Account or meter number</span><input value={form.account} onChange={(event) => change("account", event.target.value)} /></label></div>}
          <div className="grid gap-5 sm:grid-cols-2"><label className="field"><span>Transaction date and time</span><input type="datetime-local" value={form.when} onChange={(event) => change("when", event.target.value)} /></label><label className="field"><span>Notes <em>optional</em></span><input value={form.notes} onChange={(event) => change("notes", event.target.value)} /></label></div>
          <div className="rounded-xl bg-[var(--canvas)] p-4 text-sm"><p className="font-black text-[var(--teal-dark)]">Review before provider processing</p><div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-[var(--muted)]"><span>Principal: <strong className="text-[var(--teal-dark)]">{gh(amount)}</strong></span><span>Charge: <strong className="text-[var(--teal-dark)]">{gh(charge)}</strong></span><span>Customer total: <strong className="text-[var(--teal-dark)]">{gh(amount + charge)}</strong></span></div><p className="mt-2 text-xs text-[var(--muted)]">For withdrawals, confirm customer authorisation before releasing cash. For deposits, confirm the registered account name before completing the provider process.</p></div>
          <div className="flex flex-wrap gap-3"><button type="button" disabled={saving || Boolean(pendingPosting)} onClick={() => void save("DRAFT")} className="secondary-button"><Save size={16} /> Save draft</button><button type="button" disabled={saving || Boolean(pendingPosting)} onClick={() => void save(form.status)} className="primary-button"><Send size={16} /> {saving ? "Saving…" : editingId && form.status === "DRAFT" ? "Save draft changes" : "Save transaction"}</button></div>
        </section>
      </main>

      <aside className="space-y-5">
        <section className="surface p-5"><p className="eyebrow">Saved drafts</p><h2 className="section-title mt-1">Pick up where you left off</h2>{savedDrafts.length === 0 ? <p className="mt-4 text-sm text-[var(--muted)]">Saved workspace drafts will appear here.</p> : <div className="mt-4 space-y-2">{savedDrafts.map((draft) => <Link key={draft.id} href={`/new-transaction?draft=${encodeURIComponent(draft.id)}`} className="block rounded-xl border border-[var(--line)] p-3 hover:bg-[var(--canvas)]"><strong className="block text-sm text-[var(--teal-dark)]">#{draft.transaction_number} · {draft.internal_reference}</strong><span className="mt-1 block text-xs text-[var(--muted)]">{draft.transaction_type.replaceAll("_", " ")} · {gh(draft.principal_amount_pesewas)}</span></Link>)}</div>}</section>
        <section className="surface bg-[var(--teal-dark)] p-5 text-white"><ExternalLink size={18} className="text-[var(--yellow)]" /><h2 className="mt-3 font-black">Provider workflow</h2><p className="mt-2 text-sm leading-6 text-white/70">MoMo Ledger does not communicate with provider systems. Use the network’s normal USSD or app workflow, then return here to record the verified outcome.</p></section>
      </aside>
    </div>
  </div>;
}

export default function NewTransactionPage() {
  return <Suspense fallback={<div className="surface p-8 text-sm text-[var(--muted)]">Loading transaction capture…</div>}><NewTransactionExperience /></Suspense>;
}
