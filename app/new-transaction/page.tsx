"use client";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase";
import { gh, isValidGhanaPhone, NETWORKS, normalizeGhanaPhone, parsePesewas, STATUSES, TYPES, TransactionType } from "@/lib/transactions";

type Booth = { id: string; name: string; location: string };
type Business = { id: string; name: string };
const initial = { network: "MTN", phone: "", amount: "", charge: "", provider: "", name: "", notes: "", billCategory: "Electricity", account: "", status: "PENDING", when: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) };

export default function NewTransactionPage() {
  const supabase = useMemo(() => createClient(), []);
  const [type, setType] = useState<TransactionType>("DEPOSIT");
  const [form, setForm] = useState(initial);
  const [business, setBusiness] = useState<Business | null>(null);
  const [booth, setBooth] = useState<Booth | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [saved, setSaved] = useState<{ reference: string; amount: number } | null>(null);

  useEffect(() => { async function load() { if (!supabase) { setLoading(false); return; } const { data: { user } } = await supabase.auth.getUser(); if (!user) { setLoading(false); return; }
    const phoneFromCustomer = new URLSearchParams(window.location.search).get("phone"); if (phoneFromCustomer) setForm((old) => ({ ...old, phone: phoneFromCustomer }));
    const { data: membership } = await supabase.from("business_members").select("business_id,booth_id").eq("user_id", user.id).eq("status", "active").order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (membership) { const [{ data: b }, { data: bt }] = await Promise.all([supabase.from("businesses").select("id,name").eq("id", membership.business_id).maybeSingle(), supabase.from("booths").select("id,name,location").eq("id", membership.booth_id ?? "").maybeSingle()]); setBusiness(b); setBooth(bt); }
    setLoading(false);
  } load(); }, [supabase]);
  function change(key: string, value: string) { setForm((old) => ({ ...old, [key]: value })); setMessage(null); }
  async function submit(event: FormEvent) { event.preventDefault(); setMessage(null); if (!supabase || !business || !booth) return setMessage({ kind: "error", text: "Complete business and booth setup before recording a transaction." });
    const phone = normalizeGhanaPhone(form.phone); const amount = parsePesewas(form.amount); const charge = form.charge.trim() === "" ? 0 : parsePesewas(form.charge);
    if (!isValidGhanaPhone(phone)) return setMessage({ kind: "error", text: "Enter a valid Ghanaian mobile number, for example 024 123 4567 or +233 24 123 4567." });
    if (!amount) return setMessage({ kind: "error", text: "Enter an amount greater than GH₵0.00 using at most two decimal places." });
    if (charge === null) return setMessage({ kind: "error", text: "Customer charge must be a valid non-negative amount." });
    if (type === "BILL_PAYMENT" && (!form.billCategory || !form.account.trim())) return setMessage({ kind: "error", text: "Bill category and customer account or meter number are required." });
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser(); if (!user) { setSaving(false); return setMessage({ kind: "error", text: "Your session has expired. Please log in again." }); }
    let customerId: string | null = null; const { data: existing } = await supabase.from("customers").select("id").eq("business_id", business.id).eq("phone_normalized", phone).maybeSingle();
    if (existing) { customerId = existing.id; if (form.name.trim()) await supabase.from("customers").update({ full_name: form.name.trim(), phone_display: form.phone.trim() }).eq("id", existing.id); }
    else { const { data: customer, error: customerError } = await supabase.from("customers").insert({ business_id: business.id, phone_normalized: phone, phone_display: form.phone.trim(), full_name: form.name.trim() || null }).select("id").single(); if (customerError) { setSaving(false); return setMessage({ kind: "error", text: customerError.message.includes("duplicate") ? "This customer was added by another session. Please submit again." : customerError.message }); } customerId = customer.id; }
    const { data, error } = await supabase.from("transactions").insert({ business_id: business.id, booth_id: booth.id, customer_id: customerId, attendant_id: user.id, network: form.network, transaction_type: type, principal_amount_pesewas: amount, customer_charge_pesewas: charge, provider_reference: form.provider.trim() || null, customer_phone: phone, customer_name_snapshot: form.name.trim() || null, bill_category: type === "BILL_PAYMENT" ? form.billCategory : null, customer_account_reference: type === "BILL_PAYMENT" ? form.account.trim() : null, transaction_status: form.status, confirmation_method: form.status === "SUCCESSFUL" ? "MANUALLY_CONFIRMED" : null, notes: form.notes.trim() || null, transaction_at: new Date(form.when).toISOString() }).select("id,internal_reference").single();
    if (error) { setSaving(false); return setMessage({ kind: "error", text: error.message.includes("duplicate") ? "Duplicate submission blocked. Check Transactions for the existing record." : error.message }); }
    let postingNote = "";
    if (form.status === "SUCCESSFUL") {
      const { error: postingError } = await supabase.rpc("post_momo_transaction", { target_transaction_id: data.id, request_id: crypto.randomUUID() });
      if (postingError) postingNote = `Transaction recorded, but financial posting needs review: ${postingError.message}`;
    }
    setSaving(false); setSaved({ reference: data.internal_reference, amount }); setForm({ ...initial, network: form.network });
    if (postingNote) setMessage({ kind: "error", text: postingNote });
  }
  if (loading) return <p className="py-10 text-sm text-slate-500">Loading your operating booth…</p>;
  if (!business || !booth) return <div className="surface max-w-xl p-6"><p className="eyebrow">Transaction capture</p><h1 className="mt-2 text-2xl font-black text-slate-950">Finish workspace setup first</h1><p className="mt-3 text-sm leading-6 text-slate-600">Transactions are always assigned to a business and booth so attendants cannot cross tenant boundaries.</p><Link href="/setup" className="primary-button mt-6">Continue setup</Link></div>;
  return <div className="mx-auto max-w-3xl space-y-6"><div><p className="eyebrow">{business.name} · {booth.name}</p><h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">New transaction</h1><p className="mt-2 text-sm text-slate-500">Operational recording only. No provider API confirmation or commission is assumed.</p></div>
    <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">{TYPES.map((item) => <button type="button" key={item.value} onClick={() => { setType(item.value); setMessage(null); }} className={`rounded-2xl border p-4 text-left ${type === item.value ? "border-sky-400 bg-sky-50 shadow-sm" : "border-slate-200 bg-white hover:border-sky-200"}`}><span className="grid h-9 w-9 place-items-center rounded-xl bg-white text-xl font-black text-sky-600 shadow-sm">{item.icon}</span><strong className="mt-3 block text-sm text-slate-900">{item.label}</strong><span className="mt-1 block text-xs leading-4 text-slate-500">{item.description}</span></button>)}</section>
    {saved && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><p className="text-sm font-black text-emerald-900">Transaction recorded</p><p className="mt-1 text-sm text-emerald-800">{saved.reference} · {gh(saved.amount)} principal · status is PENDING or manually confirmed as selected.</p><Link href="/transactions" className="mt-3 inline-block text-sm font-bold text-emerald-900 underline">Open transaction history</Link></div>}
    {message && <div role="alert" className={`rounded-xl border p-4 text-sm ${message.kind === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{message.text}</div>}
    <form onSubmit={submit} className="surface space-y-6 p-5 sm:p-7"><div className="grid gap-5 sm:grid-cols-2"><label className="field"><span>Network</span><select value={form.network} onChange={(e) => change("network", e.target.value)}>{NETWORKS.map((n) => <option key={n.value} value={n.value}>{n.label}</option>)}</select></label><label className="field"><span>Transaction status</span><select value={form.status} onChange={(e) => change("status", e.target.value)}>{STATUSES.map((s) => <option key={s} value={s}>{s === "SUCCESSFUL" ? "Successful · manually confirmed" : s}</option>)}</select></label></div>
      <div className="grid gap-5 sm:grid-cols-2"><label className="field"><span>{type === "AIRTIME" ? "Recipient phone number" : "Customer phone number"}</span><input required inputMode="tel" placeholder="024 123 4567" value={form.phone} onChange={(e) => change("phone", e.target.value)} /></label><label className="field"><span>{type === "AIRTIME" ? "Airtime amount (GH₵)" : "Principal amount (GH₵)"}</span><input required inputMode="decimal" placeholder="200.00" value={form.amount} onChange={(e) => change("amount", e.target.value)} /></label></div>
      <div className="grid gap-5 sm:grid-cols-2"><label className="field"><span>Customer charge (GH₵) <em>optional</em></span><input inputMode="decimal" placeholder="0.00" value={form.charge} onChange={(e) => change("charge", e.target.value)} /></label><label className="field"><span>Provider reference <em>optional until available</em></span><input placeholder="External network reference" value={form.provider} onChange={(e) => change("provider", e.target.value)} /></label></div>
      {type === "BILL_PAYMENT" && <div className="grid gap-5 sm:grid-cols-2"><label className="field"><span>Bill category</span><select value={form.billCategory} onChange={(e) => change("billCategory", e.target.value)}><option>Electricity</option><option>Water</option><option>Television subscription</option><option>Other</option></select></label><label className="field"><span>Customer account or meter number</span><input required value={form.account} onChange={(e) => change("account", e.target.value)} /></label></div>}
      <div className="grid gap-5 sm:grid-cols-2"><label className="field"><span>Customer name <em>optional</em></span><input value={form.name} onChange={(e) => change("name", e.target.value)} /></label><label className="field"><span>Transaction date and time</span><input type="datetime-local" required value={form.when} onChange={(e) => change("when", e.target.value)} /></label></div>
      <label className="field"><span>Notes <em>optional</em></span><textarea rows={3} placeholder="Evidence or context for this operational record" value={form.notes} onChange={(e) => change("notes", e.target.value)} /></label>
      <div className="rounded-xl bg-slate-50 p-4 text-sm"><p className="font-black text-slate-900">Customer-facing summary</p><div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-slate-600"><span>Principal: <strong className="text-slate-900">{gh(parsePesewas(form.amount))}</strong></span><span>Charge: <strong className="text-slate-900">{gh(parsePesewas(form.charge) ?? 0)}</strong></span><span>Total expected: <strong className="text-slate-900">{gh((parsePesewas(form.amount) ?? 0) + (parsePesewas(form.charge) ?? 0))}</strong></span></div><p className="mt-2 text-xs text-slate-500">Charges are recorded separately and are not automatically treated as revenue or profit.</p></div>
      <button disabled={saving} className="primary-button w-full sm:w-auto">{saving ? "Saving transaction…" : `Record ${TYPES.find((t) => t.value === type)?.label.toLowerCase()}`}</button>
    </form></div>;
}
