"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Clipboard, Pencil, Plus, Search, UserRound } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { gh, isValidGhanaPhone, maskPhone, normalizeGhanaPhone, typeLabel } from "@/lib/transactions";
import { resolveActiveWorkspace } from "@/lib/workspace";

type Customer = { id: string; phone_normalized: string; phone_display: string; full_name: string | null; created_at: string };
type CustomerTransaction = {
  id: string;
  transaction_number: number;
  internal_reference: string;
  customer_phone: string;
  principal_amount_pesewas: number;
  transaction_at: string;
  transaction_status: string;
  transaction_type: string;
};

const CUSTOMER_PAGE_SIZE = 40;
const HISTORY_PAGE_SIZE = 25;

export default function CustomersPage() {
  const supabase = useMemo(() => createClient(), []);
  const [business, setBusiness] = useState<{ id: string; name: string } | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [history, setHistory] = useState<CustomerTransaction[]>([]);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [hasMoreCustomers, setHasMoreCustomers] = useState(false);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [historyPage, setHistoryPage] = useState(0);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function loadWorkspace() {
      if (!supabase) {
        setError("Secure customer records are not configured.");
        setLoading(false);
        return;
      }
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (cancelled) return;
      if (authError || !user) {
        setError("Please log in with an active business account to manage customers.");
        setLoading(false);
        return;
      }
      const resolution = await resolveActiveWorkspace(supabase, user.id);
      if (cancelled) return;
      if (resolution.error) {
        setError(`Business access could not be checked: ${resolution.error}`);
        setLoading(false);
        return;
      }
      if (!resolution.workspace) {
        setError("No active business membership is available. Ask the business owner to restore access or complete workspace setup.");
        setLoading(false);
        return;
      }
      setBusiness({ id: resolution.workspace.business.id, name: resolution.workspace.business.name });
      setLoading(false);
    }
    void loadWorkspace();
    return () => { cancelled = true; };
  }, [supabase]);

  useEffect(() => {
    let cancelled = false;
    async function loadCustomerPage() {
      if (!supabase || !business) return;
      setListLoading(true);
      const safeText = query.trim().replace(/[,()%_*'"\[\]{};\\\r\n]/g, " ").replace(/\s+/g, " ").trim();
      let request = supabase
        .from("customers")
        .select("id,phone_normalized,phone_display,full_name,created_at")
        .eq("business_id", business.id)
        .order("updated_at", { ascending: false })
        .range(page * CUSTOMER_PAGE_SIZE, page * CUSTOMER_PAGE_SIZE + CUSTOMER_PAGE_SIZE - 1);
      if (safeText) {
        const phoneNeedle = normalizeGhanaPhone(query).replace(/[^A-Za-z0-9]/g, "") || safeText;
        request = request.or(`full_name.ilike.%${safeText}%,phone_normalized.ilike.%${phoneNeedle}%,phone_display.ilike.%${safeText}%`);
      }
      const { data, error: customerError } = await request;
      if (cancelled) return;
      if (customerError) setError(`Customer records could not be loaded: ${customerError.message}`);
      else setError("");
      setCustomers((data ?? []) as Customer[]);
      setHasMoreCustomers((data ?? []).length === CUSTOMER_PAGE_SIZE);
      setListLoading(false);
    }
    void loadCustomerPage();
    return () => { cancelled = true; };
  }, [supabase, business, query, page]);

  useEffect(() => {
    let cancelled = false;
    async function loadHistoryPage() {
      if (!selected || !business || !supabase) {
        setHistory([]);
        setHasMoreHistory(false);
        setHistoryLoading(false);
        return;
      }
      setHistoryLoading(true);
      const { data, error: historyError } = await supabase
        .from("transactions")
        .select("id,transaction_number,internal_reference,customer_phone,principal_amount_pesewas,transaction_at,transaction_status,transaction_type")
        .eq("business_id", business.id)
        .eq("customer_id", selected.id)
        .order("transaction_at", { ascending: false })
        .range(historyPage * HISTORY_PAGE_SIZE, historyPage * HISTORY_PAGE_SIZE + HISTORY_PAGE_SIZE - 1);
      if (cancelled) return;
      if (historyError) setError(`Transaction history could not be loaded: ${historyError.message}`);
      setHistory((data ?? []) as CustomerTransaction[]);
      setHasMoreHistory((data ?? []).length === HISTORY_PAGE_SIZE);
      setHistoryLoading(false);
    }
    void loadHistoryPage();
    return () => { cancelled = true; };
  }, [selected, business, supabase, historyPage]);

  const successfulPageTotal = history
    .filter((transaction) => transaction.transaction_status === "SUCCESSFUL")
    .reduce((total, transaction) => total + Number(transaction.principal_amount_pesewas), 0);

  function selectCustomer(customer: Customer) {
    setSelected(customer);
    setHistoryPage(0);
    setNotice("");
    setError("");
  }

  function startNew() {
    setSelected(null);
    setEditingId(null);
    setName("");
    setPhone("");
    setError("");
    setNotice("");
    setEditorOpen(true);
  }

  function startEdit(customer: Customer) {
    setEditingId(customer.id);
    setName(customer.full_name ?? "");
    setPhone(customer.phone_display);
    setError("");
    setNotice("");
    setEditorOpen(true);
  }

  async function saveCustomer(event: FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!supabase || !business) return;
    const normalized = normalizeGhanaPhone(phone);
    if (!isValidGhanaPhone(normalized)) {
      setError("Enter a valid Ghanaian mobile number.");
      return;
    }
    if (name.trim().length < 2) {
      setError("Enter the customer’s name (at least 2 characters).");
      return;
    }

    setSaving(true);
    const duplicateQuery = supabase
      .from("customers")
      .select("id,phone_normalized,phone_display,full_name,created_at")
      .eq("business_id", business.id)
      .eq("phone_normalized", normalized);
    const duplicateResult = editingId
      ? await duplicateQuery.neq("id", editingId).maybeSingle()
      : await duplicateQuery.maybeSingle();
    if (duplicateResult.error) {
      setSaving(false);
      setError(`Duplicate check failed: ${duplicateResult.error.message}`);
      return;
    }
    if (duplicateResult.data) {
      setSaving(false);
      setError("A customer with this phone number is already registered in this business. Open that profile instead of creating a duplicate.");
      setSelected(duplicateResult.data as Customer);
      setHistoryPage(0);
      setEditorOpen(false);
      return;
    }

    const result = editingId
      ? await supabase.from("customers")
        .update({ full_name: name.trim(), phone_normalized: normalized, phone_display: phone.trim() })
        .eq("business_id", business.id)
        .eq("id", editingId)
        .select("id,phone_normalized,phone_display,full_name,created_at")
        .single()
      : await supabase.from("customers")
        .insert({ business_id: business.id, phone_normalized: normalized, phone_display: phone.trim(), full_name: name.trim() })
        .select("id,phone_normalized,phone_display,full_name,created_at")
        .single();

    if (result.error || !result.data) {
      setSaving(false);
      setError(result.error?.code === "23505"
        ? "A customer with this phone number was registered at the same time. Refresh the customer list and open the existing profile."
        : `Customer could not be saved: ${result.error?.message ?? "No customer record was returned."}`);
      return;
    }

    const savedCustomer = result.data as Customer;
    setCustomers((current) => [savedCustomer, ...current.filter((item) => item.id !== savedCustomer.id)]);
    setSelected(savedCustomer);
    setHistoryPage(0);
    setQuery("");
    setPage(0);
    setEditorOpen(false);
    setEditingId(null);
    setNotice(editingId ? "Customer profile updated." : "Customer registered in this business.");
    setSaving(false);
  }

  async function copyPhone(value: string) {
    try {
      await navigator.clipboard.writeText(normalizeGhanaPhone(value));
      setNotice("Phone number copied.");
    } catch {
      setNotice("Clipboard access is unavailable. Select and copy the phone number manually.");
    }
  }

  return <div className="space-y-6">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><p className="eyebrow">Customer book · {business?.name ?? "Business-scoped"}</p><h1 className="page-title">Customers</h1><p className="page-subtitle">Register and update customer details. Phone numbers are unique within this business and are never used to look up another tenant’s records.</p></div>
      <button type="button" onClick={startNew} disabled={!business || loading} className="primary-button"><Plus size={17} /> Add customer</button>
    </div>

    {(error || notice) && <div role={error ? "alert" : "status"} className={`rounded-xl border p-4 text-sm ${error ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{error || notice}</div>}

    {editorOpen && <section className="surface p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4"><div><p className="eyebrow">{editingId ? "Edit customer" : "New registration"}</p><h2 className="section-title mt-1">{editingId ? "Update customer profile" : "Register a customer"}</h2></div><button type="button" className="secondary-button" onClick={() => setEditorOpen(false)}>Close</button></div>
      <form onSubmit={(event) => void saveCustomer(event)} className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="field"><span>Customer name</span><input required minLength={2} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Full name" /></label>
        <label className="field"><span>Phone number</span><input required inputMode="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="024 123 4567" /></label>
        <div className="flex flex-wrap gap-3 sm:col-span-2"><button type="submit" disabled={saving} className="primary-button">{saving ? "Saving…" : editingId ? "Save changes" : "Register customer"}</button><span className="self-center text-xs text-[var(--muted)]">Duplicate numbers are blocked within this business by the database unique constraint.</span></div>
      </form>
    </section>}

    <section className="surface p-4"><div className="relative"><Search size={17} className="absolute left-3 top-3 text-[var(--muted)]" /><input aria-label="Search customers" className="pl-10" placeholder="Search name or phone number" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} /></div></section>

    {loading || listLoading ? <div className="surface p-8 text-sm text-[var(--muted)]">Loading business customer records…</div> : !business ? <div className="surface p-8 text-sm text-[var(--muted)]">Customer registration is available only inside an active business workspace.</div> : customers.length === 0 ? <div className="surface p-12 text-center"><UserRound className="mx-auto text-[var(--teal)]" /><p className="mt-3 font-black text-[var(--teal-dark)]">{query ? "No matching customers" : "No customer records yet"}</p><p className="mt-2 text-sm text-[var(--muted)]">{query ? "Try another name or phone number." : "Register a customer here or capture their details during a transaction."}</p></div> : <>
      <div className="grid gap-4 md:grid-cols-2">{customers.map((customer) => <button type="button" key={customer.id} onClick={() => selectCustomer(customer)} className={`surface p-5 text-left transition hover:-translate-y-0.5 hover:shadow-md ${selected?.id === customer.id ? "ring-2 ring-[var(--teal)]" : ""}`}><div className="flex items-start justify-between gap-4"><div className="min-w-0"><p className="truncate font-black text-[var(--teal-dark)]">{customer.full_name || "Unnamed customer"}</p><p className="mt-1 text-sm text-[var(--muted)]">{maskPhone(customer.phone_display)}</p></div><span className="rounded-full bg-[#e8f4f7] px-3 py-1 text-xs font-bold text-[var(--teal)]">View profile</span></div><p className="mt-4 text-xs text-[var(--muted)]">Registered {new Date(customer.created_at).toLocaleDateString("en-GH")}</p></button>)}</div>
      <div className="flex items-center justify-between gap-3"><span className="text-xs text-[var(--muted)]">Page {page + 1} · {customers.length} customers{query ? " matching search" : ""}</span><div className="flex gap-2"><button type="button" disabled={page === 0 || listLoading} onClick={() => setPage((current) => Math.max(0, current - 1))} className="secondary-button min-h-9 px-3 text-xs">Previous</button><button type="button" disabled={!hasMoreCustomers || listLoading} onClick={() => setPage((current) => current + 1)} className="secondary-button min-h-9 px-3 text-xs">Next</button></div></div>
    </>}

    {selected && <section className="surface p-5 sm:p-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><p className="eyebrow">Customer profile</p><h2 className="section-title mt-1">{selected.full_name || "Unnamed customer"}</h2><p className="mt-1 text-sm text-[var(--muted)]">{selected.phone_display}<button type="button" aria-label="Copy customer phone number" onClick={() => void copyPhone(selected.phone_display)} className="ml-2 inline-flex align-middle text-[var(--teal)]"><Clipboard size={15} /></button></p></div><div className="flex gap-2"><button type="button" onClick={() => startEdit(selected)} className="secondary-button"><Pencil size={15} /> Edit</button><button type="button" onClick={() => { setSelected(null); setHistory([]); setHistoryPage(0); }} className="secondary-button">Close</button></div></div>
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3"><div className="rounded-xl bg-[var(--canvas)] p-3"><span className="block text-xs text-[var(--muted)]">Transactions on page</span><strong>{historyLoading ? "…" : history.length}</strong></div><div className="rounded-xl bg-[var(--canvas)] p-3"><span className="block text-xs text-[var(--muted)]">Successful amount on page</span><strong>{historyLoading ? "…" : gh(successfulPageTotal)}</strong></div><div className="rounded-xl bg-[var(--canvas)] p-3"><span className="block text-xs text-[var(--muted)]">Most recent activity</span><strong className="text-sm">{historyLoading ? "…" : history[0] ? new Date(history[0].transaction_at).toLocaleDateString("en-GH") : "—"}</strong></div></div>
      <div className="mt-6"><h3 className="font-black text-[var(--teal-dark)]">Transaction history</h3>{historyLoading ? <p className="mt-3 text-sm text-[var(--muted)]">Loading transaction history…</p> : history.length === 0 ? <p className="mt-3 rounded-xl bg-[var(--canvas)] p-4 text-sm text-[var(--muted)]">No transactions on this history page.</p> : <div className="mt-3 divide-y divide-[var(--line)] rounded-xl border border-[var(--line)]">{history.map((transaction) => <div key={transaction.id} className="flex flex-col justify-between gap-2 p-4 sm:flex-row sm:items-center"><div><strong className="text-sm text-[var(--teal-dark)]">#{transaction.transaction_number} · {typeLabel(transaction.transaction_type)}</strong><p className="mt-1 text-xs text-[var(--muted)]">{transaction.internal_reference} · {new Date(transaction.transaction_at).toLocaleString("en-GH", { dateStyle: "medium", timeStyle: "short" })}</p></div><div className="sm:text-right"><strong>{gh(transaction.principal_amount_pesewas)}</strong><span className="ml-2 block text-xs text-[var(--muted)]">{transaction.transaction_status.replaceAll("_", " ")}</span></div></div>)}</div>}
        {history.length > 0 && <div className="mt-3 flex items-center justify-between gap-3"><span className="text-xs text-[var(--muted)]">History page {historyPage + 1} · {HISTORY_PAGE_SIZE} per page</span><div className="flex gap-2"><button type="button" disabled={historyPage === 0 || historyLoading} onClick={() => setHistoryPage((current) => Math.max(0, current - 1))} className="secondary-button min-h-9 px-3 text-xs">Previous</button><button type="button" disabled={!hasMoreHistory || historyLoading} onClick={() => setHistoryPage((current) => current + 1)} className="secondary-button min-h-9 px-3 text-xs">Next</button></div></div>}
      </div>
    </section>}
  </div>;
}
