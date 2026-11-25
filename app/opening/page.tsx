"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen, RefreshCw, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { gh } from "@/lib/transactions";

type Opening = {
  id: string;
  booth_id: string;
  business_date: string;
  physical_cash_pesewas: number;
  mtn_float_pesewas: number;
  telecel_float_pesewas: number;
  at_float_pesewas: number;
  notes: string | null;
  prepared_by: string;
  created_at: string;
  updated_at: string;
};

const todayInGhana = () => new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Accra" });
const toPesewas = (value: string) => {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) return null;
  const [whole, fraction = ""] = value.trim().split(".");
  const amount = Number(`${whole}${fraction.padEnd(2, "0")}`);
  return Number.isSafeInteger(amount) ? amount : null;
};
const fromPesewas = (value: number) => (value / 100).toFixed(2);

export default function OpeningPage() {
  const supabase = useMemo(() => createClient(), []);
  const [business, setBusiness] = useState<{ id: string; name: string } | null>(null);
  const [booths, setBooths] = useState<{ id: string; name: string }[]>([]);
  const [boothId, setBoothId] = useState("");
  const [date, setDate] = useState(todayInGhana);
  const [history, setHistory] = useState<Opening[]>([]);
  const [form, setForm] = useState({ physical: "", mtn: "", telecel: "", at: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;
    const membership = await supabase.from("business_members").select("business_id,booth_id,role,businesses(id,name)").eq("user_id", userData.user.id).eq("status", "active").limit(1).maybeSingle();
    if (membership.error || !membership.data) { setMessage({ type: "error", text: membership.error?.message ?? "No active business membership found." }); return; }
    const membershipData = membership.data;
    const businessData = Array.isArray(membershipData.businesses) ? membershipData.businesses[0] : membershipData.businesses;
    setBusiness(businessData as { id: string; name: string });
    const boothResult = await supabase.from("booths").select("id,name").eq("business_id", membershipData.business_id).eq("status", "ACTIVE").order("name");
    const available = (boothResult.data ?? []).filter((booth) => membershipData.role === "OWNER" || booth.id === membershipData.booth_id);
    setBooths(available);
    if (!boothId && available[0]) setBoothId(available[0].id);
    const openings = await supabase.from("daily_openings").select("id,booth_id,business_date,physical_cash_pesewas,mtn_float_pesewas,telecel_float_pesewas,at_float_pesewas,notes,prepared_by,created_at").eq("business_id", membershipData.business_id).order("business_date", { ascending: false }).limit(100);
    if (openings.error) setMessage({ type: "error", text: openings.error.message });
    else {
      const records = (openings.data ?? []) as Opening[];
      setHistory(records);
      const selected = records.find((item) => item.booth_id === (boothId || available[0]?.id) && item.business_date === date);
      if (selected) setForm({ physical: fromPesewas(selected.physical_cash_pesewas), mtn: fromPesewas(selected.mtn_float_pesewas), telecel: fromPesewas(selected.telecel_float_pesewas), at: fromPesewas(selected.at_float_pesewas), notes: selected.notes ?? "" });
    }
  }, [supabase, boothId, date]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const selected = history.find((item) => item.booth_id === boothId && item.business_date === date);
    setForm(selected ? { physical: fromPesewas(selected.physical_cash_pesewas), mtn: fromPesewas(selected.mtn_float_pesewas), telecel: fromPesewas(selected.telecel_float_pesewas), at: fromPesewas(selected.at_float_pesewas), notes: selected.notes ?? "" } : { physical: "", mtn: "", telecel: "", at: "", notes: "" });
  }, [boothId, date, history]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !business || !boothId || !date) return;
    const values = [form.physical, form.mtn, form.telecel, form.at].map(toPesewas);
    if (values.some((value) => value == null || value < 0)) { setMessage({ type: "error", text: "Enter zero or a valid amount in every balance field." }); return; }
    setBusy(true); setMessage(null);
    const existing = history.find((item) => item.booth_id === boothId && item.business_date === date);
    const result = await supabase.rpc(existing ? "update_daily_opening" : "record_daily_opening", existing ? {
      target_opening_id: existing.id,
      target_booth_id: boothId,
      target_physical_cash_pesewas: values[0],
      target_mtn_float_pesewas: values[1],
      target_telecel_float_pesewas: values[2],
      target_at_float_pesewas: values[3],
      target_notes: form.notes || null,
    } : {
      target_business_id: business.id,
      target_booth_id: boothId,
      target_business_date: date,
      target_physical_cash_pesewas: values[0],
      target_mtn_float_pesewas: values[1],
      target_telecel_float_pesewas: values[2],
      target_at_float_pesewas: values[3],
      target_notes: form.notes || null,
    });
    if (result.error) setMessage({ type: "error", text: result.error.message });
    else { setMessage({ type: "success", text: existing ? "Opening updated. The change was recorded in the opening audit trail." : "Opening recorded. You can edit it later without changing prior days." }); await load(); }
    setBusy(false);
  }

  const boothName = (id: string) => booths.find((booth) => booth.id === id)?.name ?? "Booth";
  const existingOpening = history.find((item) => item.booth_id === boothId && item.business_date === date);

  return <div className="space-y-6">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="eyebrow">Daily opening</p><h1 className="page-title">Fresh opening balances</h1><p className="page-subtitle">Start each operating day with a separate cash and network-float position. Yesterday’s opening and close stay unchanged.</p></div><div className="flex gap-2"><Link href="/reconciliation" className="secondary-button">Daily close</Link><button aria-label="Refresh openings" onClick={() => load()} className="secondary-button px-3"><RefreshCw size={16} /></button></div></div>
    {message && <div role="status" className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${message.type === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>{message.text}</div>}
    <section className="surface p-5"><div className="mb-4 flex items-center gap-2"><BookOpen size={18} className="text-[var(--teal)]" /><h2 className="section-title">Record a new operating day</h2></div><p className="mb-5 text-sm leading-6 text-[var(--muted)]">Agents can record one opening per booth and business date. Existing daily openings can be corrected; every edit is retained in the audit trail. Original onboarding balances and reconciliation closes remain separate.</p><form onSubmit={save} className="space-y-5"><div className="grid gap-4 md:grid-cols-3"><label className="field-label">Business date<input className="field-input mt-2" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label className="field-label">Booth<select className="field-input mt-2" value={boothId} onChange={(event) => setBoothId(event.target.value)}>{booths.map((booth) => <option key={booth.id} value={booth.id}>{booth.name}</option>)}</select></label><div className="flex items-end text-xs text-[var(--muted)]">{existingOpening ? <span className="rounded-xl bg-amber-50 px-3 py-2 text-amber-900">Editing the saved opening for this booth and date.</span> : <span className="rounded-xl bg-[#e8f4f7] px-3 py-2">New date = new opening record.</span>}</div></div><div className="grid gap-4 sm:grid-cols-2"><label className="field-label">Physical cash (GH₵)<input required className="field-input mt-2" inputMode="decimal" min="0" step="0.01" value={form.physical} onChange={(event) => setForm({ ...form, physical: event.target.value })} placeholder="0.00" /></label><label className="field-label">MTN MoMo float (GH₵)<input required className="field-input mt-2" inputMode="decimal" min="0" step="0.01" value={form.mtn} onChange={(event) => setForm({ ...form, mtn: event.target.value })} placeholder="0.00" /></label><label className="field-label">Telecel Cash float (GH₵)<input required className="field-input mt-2" inputMode="decimal" min="0" step="0.01" value={form.telecel} onChange={(event) => setForm({ ...form, telecel: event.target.value })} placeholder="0.00" /></label><label className="field-label">AT Money float (GH₵)<input required className="field-input mt-2" inputMode="decimal" min="0" step="0.01" value={form.at} onChange={(event) => setForm({ ...form, at: event.target.value })} placeholder="0.00" /></label></div><label className="field-label block">Notes <span className="font-normal text-[#98a0a5]">(optional)<textarea className="field-input mt-2 min-h-20" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Opening handover or operational context…" /></span></label><button disabled={busy || !boothId} className="primary-button">{busy ? "Saving…" : existingOpening ? "Update opening" : "Save fresh opening"}</button></form></section>
    <section className="surface p-5"><div className="mb-4 flex items-center gap-2"><ShieldCheck size={18} className="text-[var(--teal)]" /><div><p className="eyebrow">Historical record</p><h2 className="section-title">Opening history</h2></div></div>{history.length === 0 ? <p className="rounded-2xl bg-[var(--canvas)] p-6 text-center text-sm text-[var(--muted)]">No daily openings have been recorded yet.</p> : <div className="overflow-x-auto"><table className="data-table"><thead><tr><th>Date</th><th>Booth</th><th>Cash</th><th>MTN</th><th>Telecel</th><th>AT</th><th>Prepared by</th></tr></thead><tbody>{history.map((item) => <tr key={item.id}><td className="font-semibold">{item.business_date}</td><td>{boothName(item.booth_id)}</td><td>{gh(item.physical_cash_pesewas)}</td><td>{gh(item.mtn_float_pesewas)}</td><td>{gh(item.telecel_float_pesewas)}</td><td>{gh(item.at_float_pesewas)}</td><td className="font-mono text-xs">{item.prepared_by.slice(0, 8)}…</td></tr>)}</tbody></table></div>}</section>
  </div>;
}
