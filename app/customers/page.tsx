"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase";
import { gh, isValidGhanaPhone, maskPhone, normalizeGhanaPhone, typeLabel } from "@/lib/transactions";

type Membership = { business_id: string; role: "OWNER" | "ATTENDANT" };
type Customer = { id: string; phone_normalized: string; phone_display: string; full_name: string | null; created_at: string };
type Transaction = { id: string; internal_reference: string; transaction_type: string; network: string; principal_amount_pesewas: number; transaction_status: string; transaction_at: string };
const PAGE_SIZE = 25;

export default function CustomersPage() {
  const supabase = useMemo(() => createClient(), []);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [selected, setSelected] = useState<Customer | null>(null);
  const [history, setHistory] = useState<Transaction[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const loadCustomers = useCallback(async (businessId: string, pageIndex: number, term: string) => {
    if (!supabase) return;
    setLoading(true);
    setError("");
    let query = supabase.from("customers").select("id,phone_normalized,phone_display,full_name,created_at", { count: "exact" }).eq("business_id", businessId);
    const safeTerm = term.trim().replace(/[^A-Za-z0-9+ ]/g, "").slice(0, 80).trim();
    if (safeTerm) {
      const normalized = normalizeGhanaPhone(safeTerm);
      query = query.or(`full_name.ilike.%${safeTerm}%,phone_display.ilike.%${safeTerm}%,phone_normalized.ilike.%${normalized}%`);
    }
    const { data, count, error: queryError } = await query.order("created_at", { ascending: false }).range(pageIndex * PAGE_SIZE, (pageIndex + 1) * PAGE_SIZE - 1);
    if (queryError) setError(queryError.message);
    else { setCustomers((data ?? []) as Customer[]); setTotal(count ?? 0); }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    async function initialize() {
      if (!supabase) { setError("Supabase is not configured for this application."); setLoading(false); return; }
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setError("Sign in to view customers."); setLoading(false); return; }
      const { data, error: memberError } = await supabase.from("business_members").select("business_id,role").eq("user_id", user.id).eq("status", "active").order("created_at", { ascending: true }).limit(1).maybeSingle();
      if (memberError || !data) { setError(memberError?.message ?? "No active business membership was found."); setLoading(false); return; }
      const current = data as Membership;
      setMembership(current);
    }
    void initialize();
  }, [supabase, loadCustomers]);

  useEffect(() => {
    if (!membership) return;
    const timer = window.setTimeout(() => { void loadCustomers(membership.business_id, page, search); }, 250);
    return () => window.clearTimeout(timer);
  }, [membership, page, search, loadCustomers]);

  async function addCustomer(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !membership) return;
    const normalized = normalizeGhanaPhone(phone);
    if (!isValidGhanaPhone(normalized)) { setError("Enter a valid Ghanaian mobile number, for example 024 123 4567 or +233 24 123 4567."); return; }
    setSaving(true); setError(""); setNotice("");
    const { error: insertError } = await supabase.from("customers").insert({ business_id: membership.business_id, phone_normalized: normalized, phone_display: phone.trim(), full_name: name.trim() || null });
    setSaving(false);
    if (insertError) {
      setError(insertError.code === "23505" ? "A customer with this phone number already exists in this business." : insertError.message);
      return;
    }
    setShowForm(false); setName(""); setPhone(""); setSearch(""); setPage(0);
    setNotice("Customer added. They can now be selected through transaction entry by entering the same phone number.");
    await loadCustomers(membership.business_id, 0, "");
  }

  async function openCustomer(customer: Customer) {
    setSelected(customer); setHistory([]); setHistoryLoading(true);
    if (supabase && membership) {
      const { data, error: historyError } = await supabase.from("transactions").select("id,internal_reference,transaction_type,network,principal_amount_pesewas,transaction_status,transaction_at").eq("business_id", membership.business_id).eq("customer_id", customer.id).order("transaction_at", { ascending: false }).limit(10);
      if (historyError) setError(historyError.message);
      else setHistory((data ?? []) as Transaction[]);
    }
    setHistoryLoading(false);
  }

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return <div className="space-y-6">
    <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><p className="eyebrow">Customer book</p><h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Customers</h1><p className="mt-2 max-w-2xl text-sm text-slate-600">A business-scoped directory of customers identified by their normalized Ghanaian phone number.</p></div>
      <button className="primary-button w-fit" onClick={() => { setShowForm(true); setError(""); }}>+ Add customer</button>
    </header>
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
    {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</div>}
    <section className="surface p-4 sm:p-5">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><label className="field w-full sm:max-w-md"><span>Search customers</span><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Name or phone number" /></label><p className="text-sm text-slate-500">{total} {total === 1 ? "customer" : "customers"}</p></div>
      {loading ? <p className="py-10 text-sm text-slate-500">Loading customer directory…</p> : customers.length === 0 ? <div className="py-12 text-center"><h2 className="font-bold text-slate-900">{search ? "No matching customers" : "No customers yet"}</h2><p className="mt-2 text-sm text-slate-500">Add a customer here, or the customer will be added automatically the first time you record a transaction with their phone number.</p>{!search && <button className="primary-button mt-5" onClick={() => setShowForm(true)}>Add your first customer</button>}</div> : <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[520px] text-left text-sm"><thead className="border-y border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Phone</th><th className="px-4 py-3">Added</th><th className="px-4 py-3" /></tr></thead><tbody className="divide-y divide-slate-100">{customers.map((customer) => <tr key={customer.id} className="hover:bg-sky-50/50"><td className="px-4 py-4"><button className="text-left font-bold text-slate-900 hover:text-sky-700" onClick={() => void openCustomer(customer)}>{customer.full_name || "Unnamed customer"}</button></td><td className="px-4 py-4 text-slate-600">{customer.phone_display || maskPhone(customer.phone_normalized)}</td><td className="px-4 py-4 text-slate-500">{new Date(customer.created_at).toLocaleDateString("en-GH", { dateStyle: "medium", timeZone: "Africa/Accra" })}</td><td className="px-4 py-4 text-right"><button className="text-sm font-bold text-sky-700" onClick={() => void openCustomer(customer)}>View history</button></td></tr>)}</tbody></table><div className="flex items-center justify-between border-t border-slate-100 px-2 py-4"><span className="text-xs text-slate-500">Page {page + 1} of {pages}</span><div className="flex gap-2"><button className="secondary-button" disabled={page === 0} onClick={() => setPage((current) => current - 1)}>Previous</button><button className="secondary-button" disabled={page + 1 >= pages} onClick={() => setPage((current) => current + 1)}>Next</button></div></div></div>}
    </section>
    <p className="text-xs leading-5 text-slate-500">Customer names and numbers are stored per business. Transaction records remain operational history and are not changed when you add a customer.</p>

    {showForm && <div className="fixed inset-0 z-30 grid place-items-center bg-slate-950/40 p-4"><form onSubmit={addCustomer} role="dialog" aria-modal="true" aria-labelledby="add-customer-title" className="surface w-full max-w-lg space-y-5 p-5 sm:p-6"><div className="flex items-start justify-between gap-4"><div><p className="eyebrow">Customer book</p><h2 id="add-customer-title" className="mt-2 text-xl font-black text-slate-950">Add customer</h2><p className="mt-1 text-sm text-slate-500">Phone number is the unique customer identifier within this business.</p></div><button type="button" className="secondary-button" onClick={() => setShowForm(false)}>Close</button></div><label className="field"><span>Phone number</span><input autoFocus required inputMode="tel" placeholder="024 123 4567" value={phone} onChange={(event) => setPhone(event.target.value)} /></label><label className="field"><span>Customer name <em>optional</em></span><input maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>{error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}<div className="flex justify-end gap-2"><button type="button" className="secondary-button" onClick={() => setShowForm(false)}>Cancel</button><button disabled={saving} className="primary-button">{saving ? "Adding customer…" : "Add customer"}</button></div></form></div>}

    {selected && <div className="fixed inset-0 z-30 grid place-items-center bg-slate-950/40 p-4"><section role="dialog" aria-modal="true" aria-labelledby="customer-history-title" className="surface max-h-[85vh] w-full max-w-2xl overflow-y-auto p-5 sm:p-6"><div className="flex items-start justify-between gap-4"><div><p className="eyebrow">Customer record</p><h2 id="customer-history-title" className="mt-2 text-xl font-black text-slate-950">{selected.full_name || "Unnamed customer"}</h2><p className="mt-1 text-sm text-slate-500">{selected.phone_display} · {selected.phone_normalized}</p></div><button className="secondary-button" onClick={() => setSelected(null)}>Close</button></div><div className="mt-5 flex items-center justify-between gap-4"><h3 className="font-bold text-slate-900">Recent linked transactions</h3><Link href={`/new-transaction?phone=${encodeURIComponent(selected.phone_display)}`} className="text-sm font-bold text-sky-700">Record transaction</Link></div>{historyLoading ? <p className="py-8 text-sm text-slate-500">Loading linked transactions…</p> : history.length === 0 ? <p className="py-8 text-sm text-slate-500">No transactions are linked to this customer yet.</p> : <div className="mt-3 divide-y divide-slate-100">{history.map((row) => <article key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="font-bold text-slate-900">{row.internal_reference} · {typeLabel(row.transaction_type)}</p><p className="mt-1 text-xs text-slate-500">{row.network} · {new Date(row.transaction_at).toLocaleString("en-GH", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Accra" })}</p></div><div className="text-right"><p className="font-bold text-slate-900">{gh(row.principal_amount_pesewas)}</p><p className="text-xs text-slate-500">{row.transaction_status}</p></div></article>)}</div>}<p className="mt-3 text-xs text-slate-500">Showing up to 10 latest records. Transaction amounts are principal only, not customer charges or profit.</p></section></div>}
  </div>;
}
