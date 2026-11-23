"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase";

type Business = { id: string; name: string; business_type: string; owner_name: string; contact_phone: string; contact_email: string; region: string; town_city: string; address: string; digital_address: string | null; setup_status: string };
type Booth = { id: string; name: string; location: string; description: string | null };
type Balances = { physical_cash_pesewas: number } & Record<string, number>;
type BusinessForm = { name: string; business_type: string; owner_name: string; contact_phone: string; contact_email: string; region: string; town_city: string; address: string; digital_address: string };
type PendingBusinessCreate = { requestId: string; payload: BusinessForm };
const ghRegions = ["Ahafo", "Ashanti", "Bono", "Bono East", "Central", "Eastern", "Greater Accra", "North East", "Northern", "Oti", "Savannah", "Upper East", "Upper West", "Volta", "Western", "Western North"];
const steps = ["Business", "Booth", "Opening balances", "Review"];
function amountToPesewas(value: string) { const numeric = Number(value); return Number.isFinite(numeric) && numeric >= 0 ? Math.round(numeric * 100) : NaN; }
function pesewasToAmount(value: number | null | undefined) { return ((value ?? 0) / 100).toFixed(2); }

export default function SetupPage() {
  const supabase = useMemo(() => createClient(), []);
  const [userId, setUserId] = useState<string | null>(null);
  const [business, setBusiness] = useState<Business | null>(null);
  const [booth, setBooth] = useState<Booth | null>(null);
  const [balances, setBalances] = useState<Balances | null>(null);
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pendingBusinessCreate, setPendingBusinessCreate] = useState<PendingBusinessCreate | null>(null);
  const [notice, setNotice] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [businessForm, setBusinessForm] = useState<BusinessForm>({ name: "", business_type: "mobile_money_agent", owner_name: "", contact_phone: "", contact_email: "", region: "Greater Accra", town_city: "", address: "", digital_address: "" });
  const [boothForm, setBoothForm] = useState({ name: "Main booth", location: "", description: "" });
  const [balanceForm, setBalanceForm] = useState({ physical: "", mtn: "", telecel: "", at: "" });

  async function load() {
    if (!supabase) { setLoading(false); return; }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { window.location.href = "/auth"; return; }
    setUserId(user.id);
    setBusinessForm(current => ({ ...current, owner_name: user.user_metadata?.full_name ?? "", contact_phone: user.user_metadata?.phone ?? "", contact_email: user.email ?? "" }));
    const { data: businesses, error } = await supabase.from("businesses").select("id,name,business_type,owner_name,contact_phone,contact_email,region,town_city,address,digital_address,setup_status").eq("owner_id", user.id).order("created_at", { ascending: true }).limit(1);
    if (error) { setNotice({ type: "error", text: error.message }); setLoading(false); return; }
    const found = businesses?.[0] as Business | undefined;
    const setupStorageKey = `momo-ledger:setup-business:v1:${user.id}`;
    if (found) {
      window.localStorage.removeItem(setupStorageKey);
      setBusiness(found); setBusinessForm({ ...found, digital_address: found.digital_address ?? "" });
      const { data: booths } = await supabase.from("booths").select("id,name,location,description").eq("business_id", found.id).order("created_at", { ascending: true }).limit(1);
      const foundBooth = booths?.[0] as Booth | undefined;
      if (foundBooth) { setBooth(foundBooth); setBoothForm({ name: foundBooth.name, location: foundBooth.location, description: foundBooth.description ?? "" }); }
      const { data: cash } = await supabase.from("business_opening_balances").select("physical_cash_pesewas").eq("business_id", found.id).maybeSingle();
      const { data: floats } = foundBooth ? await supabase.from("booth_opening_balances").select("network,amount_pesewas").eq("booth_id", foundBooth.id) : { data: [] as { network: string; amount_pesewas: number }[] };
      if (cash) { const map: Balances = { physical_cash_pesewas: cash.physical_cash_pesewas, MTN: 0, TELECEL: 0, AT: 0 }; (floats ?? []).forEach(item => { map[item.network] = item.amount_pesewas; }); setBalances(map); setBalanceForm({ physical: pesewasToAmount(map.physical_cash_pesewas), mtn: pesewasToAmount(map.MTN), telecel: pesewasToAmount(map.TELECEL), at: pesewasToAmount(map.AT) }); }
      setStep(found.setup_status === "complete" ? 3 : found.setup_status === "balances" ? 3 : found.setup_status === "booth" ? 2 : 1);
    } else {
      try {
        const saved = window.localStorage.getItem(setupStorageKey);
        if (saved) {
          const candidate = JSON.parse(saved) as Partial<PendingBusinessCreate>;
          const payload = candidate.payload as Partial<BusinessForm> | undefined;
          const values = payload ? Object.values(payload) : [];
          if (typeof candidate.requestId === "string" && candidate.requestId.length >= 8 && payload && values.length === 9 && values.every((value) => typeof value === "string")) {
            const pending = candidate as PendingBusinessCreate;
            setPendingBusinessCreate(pending); setBusinessForm(pending.payload);
          } else window.localStorage.removeItem(setupStorageKey);
        }
      } catch {
        setNotice({ type: "error", text: "A saved setup retry could not be read. No new business was created; reload or contact support before trying again." });
      }
    }
    setLoading(false);
  }
  useEffect(() => { load(); }, [supabase]);

  async function saveBusiness(event: FormEvent) {
    event.preventDefault(); if (!supabase || !userId) return; setNotice(null);
    if (businessForm.name.trim().length < 2 || businessForm.town_city.trim().length < 2 || businessForm.address.trim().length < 2) { setNotice({ type: "error", text: "Complete the business name, town or city, and address." }); return; }
    setBusy(true);
    if (business) {
      const { data, error } = await supabase.from("businesses").update({ ...businessForm, digital_address: businessForm.digital_address || null }).eq("id", business.id).select("id,name,business_type,owner_name,contact_phone,contact_email,region,town_city,address,digital_address,setup_status").single();
      if (error) setNotice({ type: "error", text: error.message }); else { setBusiness(data); setStep(1); }
    } else {
      const pending = pendingBusinessCreate ?? { requestId: crypto.randomUUID(), payload: businessForm };
      try { window.localStorage.setItem(`momo-ledger:setup-business:v1:${userId}`, JSON.stringify(pending)); }
      catch { setNotice({ type: "error", text: "This browser could not save a safe setup retry key. No business was sent; enable site storage and try again." }); setBusy(false); return; }
      setPendingBusinessCreate(pending);
      const { data, error } = await supabase.rpc("create_business_setup", {
        request_id: pending.requestId,
        business_name: pending.payload.name,
        business_type: pending.payload.business_type,
        owner_name: pending.payload.owner_name,
        contact_phone: pending.payload.contact_phone,
        contact_email: pending.payload.contact_email,
        region: pending.payload.region,
        town_city: pending.payload.town_city,
        address: pending.payload.address,
        digital_address: pending.payload.digital_address || null,
      });
      if (error) {
        const statusCode = (error as { status?: number }).status;
        if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 500 && statusCode !== 408) {
          window.localStorage.removeItem(`momo-ledger:setup-business:v1:${userId}`); setPendingBusinessCreate(null);
          setNotice({ type: "error", text: error.message });
        } else {
          setNotice({ type: "error", text: `${error.message} The result is uncertain; retry the same locked setup request. Its key is saved in this browser.` });
        }
      } else {
        const result = data as { business_id: string };
        const created: Business = { id: result.business_id, ...pending.payload, digital_address: pending.payload.digital_address || null, setup_status: "business" };
        window.localStorage.removeItem(`momo-ledger:setup-business:v1:${userId}`);
        setPendingBusinessCreate(null); setBusiness(created); setStep(1);
      }
    }
    setBusy(false);
  }
  async function saveBooth(event: FormEvent) {
    event.preventDefault(); if (!supabase || !userId || !business) return; setNotice(null); if (boothForm.name.trim().length < 2 || boothForm.location.trim().length < 2) { setNotice({ type: "error", text: "Add a booth name and location." }); return; }
    setBusy(true); const result = booth ? await supabase.from("booths").update(boothForm).eq("id", booth.id).select("id,name,location,description").single() : await supabase.from("booths").insert({ ...boothForm, business_id: business.id }).select("id,name,location,description").single();
    if (result.error) setNotice({ type: "error", text: result.error.message }); else { setBooth(result.data); await supabase.from("businesses").update({ setup_status: "booth" }).eq("id", business.id); setBusiness({ ...business, setup_status: "booth" }); setStep(2); }
    setBusy(false);
  }
  async function saveBalances(event: FormEvent) {
    event.preventDefault(); if (!supabase || !userId || !business || !booth) return; setNotice(null);
    const values = [balanceForm.physical, balanceForm.mtn, balanceForm.telecel, balanceForm.at].map(amountToPesewas);
    if (values.some(value => !Number.isInteger(value) || value < 0)) { setNotice({ type: "error", text: "Enter zero or a valid amount in each balance field." }); return; }
    setBusy(true); const cashExists = balances !== null;
    if (cashExists) { setNotice({ type: "error", text: "Opening balances already exist and are locked. Future corrections must be authorised adjustments." }); setBusy(false); return; }
    const cash = await supabase.from("business_opening_balances").insert({ business_id: business.id, physical_cash_pesewas: values[0], created_by: userId });
    if (cash.error) { setNotice({ type: "error", text: cash.error.message }); setBusy(false); return; }
    const floats = await supabase.from("booth_opening_balances").insert([{ business_id: business.id, booth_id: booth.id, network: "MTN", amount_pesewas: values[1], created_by: userId }, { business_id: business.id, booth_id: booth.id, network: "TELECEL", amount_pesewas: values[2], created_by: userId }, { business_id: business.id, booth_id: booth.id, network: "AT", amount_pesewas: values[3], created_by: userId }]);
    if (floats.error) setNotice({ type: "error", text: floats.error.message }); else { setBalances({ physical_cash_pesewas: values[0], MTN: values[1], TELECEL: values[2], AT: values[3] }); await supabase.from("businesses").update({ setup_status: "balances" }).eq("id", business.id); setBusiness({ ...business, setup_status: "balances" }); setStep(3); }
    setBusy(false);
  }
  async function completeSetup() { if (!supabase || !business || !balances) return; setBusy(true); const { error } = await supabase.from("businesses").update({ setup_status: "complete" }).eq("id", business.id); if (error) setNotice({ type: "error", text: error.message }); else { setBusiness({ ...business, setup_status: "complete" }); window.location.href = "/dashboard"; } setBusy(false); }

  if (loading) return <main className="mx-auto max-w-3xl py-16"><p className="eyebrow">Workspace setup</p><p className="mt-4 text-sm text-slate-500">Loading your secure workspace…</p></main>;
  if (!supabase) return <main className="mx-auto max-w-3xl py-16"><div className="surface p-8"><p className="eyebrow">Workspace setup</p><h1 className="mt-3 text-3xl font-black">Supabase is not configured</h1><p className="mt-3 text-sm leading-6 text-slate-500">Add the Supabase public URL and anonymous key to the deployment environment to enable secure onboarding.</p></div></main>;
  return <main className="mx-auto max-w-4xl pb-10"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="eyebrow">Owner onboarding</p><h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Set up your MoMo workspace</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">Save each step as you go. You can safely leave and resume without creating duplicate businesses or balances.</p></div><Link href="/dashboard" className="secondary-button w-fit">Exit setup</Link></div><div className="mt-8 grid grid-cols-4 gap-2">{steps.map((label, index) => <div key={label}><div className={`h-1.5 rounded-full ${index <= step ? "bg-sky-400" : "bg-slate-200"}`} /><p className={`mt-2 text-xs font-bold ${index === step ? "text-slate-950" : "text-slate-400"}`}>{index + 1}. {label}</p></div>)}</div>{notice && <div role="status" className={`mt-6 rounded-xl px-4 py-3 text-sm leading-6 ${notice.type === "error" ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>{notice.text}</div>}<div className="surface mt-8 p-5 sm:p-8">{step === 0 && <form onSubmit={saveBusiness} className="space-y-5"><fieldset disabled={busy || pendingBusinessCreate !== null} className="contents"><div><p className="eyebrow">Step 1</p><h2 className="mt-2 text-xl font-black">Tell us about the business</h2></div><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-bold text-slate-700 sm:col-span-2">Business name<input required value={businessForm.name} onChange={e => setBusinessForm({ ...businessForm, name: e.target.value })} placeholder="e.g. Adwoa MoMo Services" className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-sky-400" /></label><label className="text-sm font-bold text-slate-700">Business type<select value={businessForm.business_type} onChange={e => setBusinessForm({ ...businessForm, business_type: e.target.value })} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 outline-none focus:border-sky-400"><option value="mobile_money_agent">Mobile Money Agent</option><option value="mobile_money_vendor">Mobile Money Vendor</option><option value="mobile_money_booth">Mobile Money Booth</option><option value="other">Other</option></select></label><label className="text-sm font-bold text-slate-700">Owner name<input required value={businessForm.owner_name} onChange={e => setBusinessForm({ ...businessForm, owner_name: e.target.value })} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-sky-400" /></label><label className="text-sm font-bold text-slate-700">Contact phone<input required value={businessForm.contact_phone} onChange={e => setBusinessForm({ ...businessForm, contact_phone: e.target.value })} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-sky-400" /></label><label className="text-sm font-bold text-slate-700">Contact email<input required type="email" value={businessForm.contact_email} onChange={e => setBusinessForm({ ...businessForm, contact_email: e.target.value })} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-sky-400" /></label><label className="text-sm font-bold text-slate-700">Region<select value={businessForm.region} onChange={e => setBusinessForm({ ...businessForm, region: e.target.value })} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 outline-none focus:border-sky-400">{ghRegions.map(region => <option key={region}>{region}</option>)}</select></label><label className="text-sm font-bold text-slate-700">Town or city<input required value={businessForm.town_city} onChange={e => setBusinessForm({ ...businessForm, town_city: e.target.value })} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-sky-400" /></label><label className="text-sm font-bold text-slate-700 sm:col-span-2">Business address or location description<textarea required value={businessForm.address} onChange={e => setBusinessForm({ ...businessForm, address: e.target.value })} rows={3} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-sky-400" /></label><label className="text-sm font-bold text-slate-700 sm:col-span-2">Ghana digital address <span className="font-normal text-slate-400">(optional)</span><input value={businessForm.digital_address ?? ""} onChange={e => setBusinessForm({ ...businessForm, digital_address: e.target.value })} placeholder="e.g. GA-123-4567" className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-sky-400" /></label></div></fieldset>{pendingBusinessCreate && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">The last setup save may have completed. Details are locked and the same request key will be reused; retry to safely confirm without creating another business.</p>}<button disabled={busy} className="primary-button w-full sm:w-auto">{busy ? "Saving…" : pendingBusinessCreate ? "Retry same safe save" : business ? "Save and continue" : "Save business and continue"}</button></form>}{step === 1 && <form onSubmit={saveBooth} className="space-y-5"><div><p className="eyebrow">Step 2</p><h2 className="mt-2 text-xl font-black">Create your first booth</h2><p className="mt-2 text-sm leading-6 text-slate-500">Start with one booth. You can add advanced branch management in a later stage.</p></div><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-bold text-slate-700">Booth name<input required value={boothForm.name} onChange={e => setBoothForm({ ...boothForm, name: e.target.value })} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-sky-400" /></label><label className="text-sm font-bold text-slate-700">Booth location<input required value={boothForm.location} onChange={e => setBoothForm({ ...boothForm, location: e.target.value })} placeholder="e.g. Madina market entrance" className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-sky-400" /></label><label className="text-sm font-bold text-slate-700 sm:col-span-2">Description <span className="font-normal text-slate-400">(optional)</span><textarea value={boothForm.description} onChange={e => setBoothForm({ ...boothForm, description: e.target.value })} rows={3} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-sky-400" /></label></div><button disabled={busy} className="primary-button w-full sm:w-auto">{busy ? "Saving…" : booth ? "Save booth and continue" : "Create booth and continue"}</button></form>}{step === 2 && <form onSubmit={saveBalances} className="space-y-5"><div><p className="eyebrow">Step 3</p><h2 className="mt-2 text-xl font-black">Enter opening balances</h2><p className="mt-2 text-sm leading-6 text-slate-500">These are starting positions, not income or customer transactions. They are stored as pesewas and locked after confirmation.</p></div><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-bold text-slate-700">Physical cash (GH₵)<input required inputMode="decimal" min="0" step="0.01" value={balanceForm.physical} onChange={e => setBalanceForm({ ...balanceForm, physical: e.target.value })} placeholder="0.00" className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-sky-400" /></label><label className="text-sm font-bold text-slate-700">MTN MoMo float (GH₵)<input required inputMode="decimal" min="0" step="0.01" value={balanceForm.mtn} onChange={e => setBalanceForm({ ...balanceForm, mtn: e.target.value })} placeholder="0.00" className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-sky-400" /></label><label className="text-sm font-bold text-slate-700">Telecel Cash float (GH₵)<input required inputMode="decimal" min="0" step="0.01" value={balanceForm.telecel} onChange={e => setBalanceForm({ ...balanceForm, telecel: e.target.value })} placeholder="0.00" className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-sky-400" /></label><label className="text-sm font-bold text-slate-700">AT Money float (GH₵)<input required inputMode="decimal" min="0" step="0.01" value={balanceForm.at} onChange={e => setBalanceForm({ ...balanceForm, at: e.target.value })} placeholder="0.00" className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-sky-400" /></label></div><button disabled={busy || Boolean(balances)} className="primary-button w-full sm:w-auto">{busy ? "Saving…" : balances ? "Opening balances saved" : "Save opening balances"}</button></form>}{step === 3 && business && booth && balances && <div className="space-y-6"><div><p className="eyebrow">Step 4</p><h2 className="mt-2 text-xl font-black">Review before entering your workspace</h2><p className="mt-2 text-sm leading-6 text-slate-500">Review the setup summary. Opening balances are initial entries and will not count as revenue, commissions or profit.</p></div><div className="grid gap-4 sm:grid-cols-2"><div className="rounded-xl border border-slate-200 p-4"><p className="eyebrow">Business</p><p className="mt-2 font-black text-slate-900">{business.name}</p><p className="mt-1 text-sm text-slate-500">{business.business_type.replaceAll("_", " ")} · {business.town_city}, {business.region}</p></div><div className="rounded-xl border border-slate-200 p-4"><p className="eyebrow">First booth</p><p className="mt-2 font-black text-slate-900">{booth.name}</p><p className="mt-1 text-sm text-slate-500">{booth.location}</p></div>{[["Physical cash", balances.physical_cash_pesewas], ["MTN float", balances.MTN], ["Telecel float", balances.TELECEL], ["AT Money float", balances.AT]].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-sky-50 p-4"><p className="text-sm font-bold text-slate-600">{label}</p><p className="mt-2 text-xl font-black text-slate-950">GH₵ {pesewasToAmount(Number(value))}</p><p className="mt-1 text-xs text-slate-500">Opening balance</p></div>)}</div><button disabled={busy || business.setup_status === "complete"} onClick={completeSetup} className="primary-button w-full sm:w-auto">{busy ? "Finishing setup…" : business.setup_status === "complete" ? "Setup complete" : "Confirm and enter dashboard"}</button></div>}</div></main>;
}
