"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase";
import { gh, NETWORKS, parsePesewas } from "@/lib/transactions";

type Membership = { business_id: string; booth_id: string | null; role: "OWNER" | "ATTENDANT" };
type Booth = { id: string; name: string };
type Account = { id: string; booth_id: string | null; account_code: string; account_category: string; network: string | null; opening_balance_pesewas: number; current_balance_pesewas: number; allow_overdraft: boolean };
type Movement = { entry_id: string; occurred_at: string; internal_reference: string; description: string; entry_type: string; network: string | null; money_in_pesewas: number; money_out_pesewas: number; running_balance_pesewas: number; status: string };
function label(account: Account, booths: Booth[]) { const booth = booths.find((item) => item.id === account.booth_id)?.name; return `${account.network ?? account.account_code.replaceAll("_", " ")}${booth ? ` · ${booth}` : " · Business-wide"}`; }

export default function FloatManagementPage() {
  const supabase = useMemo(() => createClient(), []);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [booths, setBooths] = useState<Booth[]>([]);
  const [boothFilter, setBoothFilter] = useState("");
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [thresholdInput, setThresholdInput] = useState("");
  const [thresholdPesewas, setThresholdPesewas] = useState<number | null>(null);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [movementLoading, setMovementLoading] = useState(false);
  const [error, setError] = useState("");
  const [movementError, setMovementError] = useState("");
  const movementRequestId = useRef(0);

  const floatAccounts = useMemo(() => accounts.filter((account) => account.account_category === "ELECTRONIC_FLOAT" && (membership?.role === "OWNER" ? !boothFilter || account.booth_id === boothFilter || account.booth_id === null : account.booth_id === membership?.booth_id || account.booth_id === null)), [accounts, membership, boothFilter]);
  const loadMovements = useCallback(async (member: Membership, accountId: string, boothId: string) => {
    const requestId = ++movementRequestId.current;
    if (!supabase || !accountId) { setMovements([]); setMovementLoading(false); return; }
    setMovementLoading(true); setMovementError("");
    const { data, error: queryError } = await supabase.rpc("cashbook_page", {
      target_business_id: member.business_id,
      target_booth_id: member.role === "OWNER" ? boothId || null : member.booth_id,
      target_account_id: accountId,
      target_entry_type: null,
      target_from: null,
      target_to: null,
      page_size: 8,
      page_offset: 0,
    });
    if (requestId !== movementRequestId.current) return;
    if (queryError) { setMovements([]); setMovementError(queryError.message); }
    else setMovements((data ?? []) as Movement[]);
    setMovementLoading(false);
  }, [supabase]);

  useEffect(() => {
    async function initialize() {
      if (!supabase) { setError("Supabase is not configured for this application."); setLoading(false); return; }
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setError("Sign in to view float accounts."); setLoading(false); return; }
      const { data: membershipData, error: memberError } = await supabase.from("business_members").select("business_id,booth_id,role").eq("user_id", user.id).eq("status", "active").order("created_at", { ascending: true }).limit(1).maybeSingle();
      if (memberError || !membershipData) { setError(memberError?.message ?? "No active business membership was found."); setLoading(false); return; }
      const member = membershipData as Membership;
      setMembership(member);
      const [accountResult, boothResult] = await Promise.all([
        supabase.from("financial_accounts").select("id,booth_id,account_code,account_category,network,opening_balance_pesewas,current_balance_pesewas,allow_overdraft").eq("business_id", member.business_id).eq("account_category", "ELECTRONIC_FLOAT").order("network"),
        supabase.from("booths").select("id,name").eq("business_id", member.business_id).order("name"),
      ]);
      if (accountResult.error) setError(accountResult.error.message);
      if (boothResult.error) setError(boothResult.error.message);
      const visibleAccounts = ((accountResult.data ?? []) as Account[]).filter((account) => member.role === "OWNER" || account.booth_id === null || account.booth_id === member.booth_id);
      setAccounts(visibleAccounts); setBooths((boothResult.data ?? []) as Booth[]);
      if (visibleAccounts[0]) setSelectedAccountId(visibleAccounts[0].id);
      try {
        const saved = window.localStorage.getItem(`momo-ledger:float-alert:v1:${member.business_id}`);
        if (saved) {
          const cents = Number(saved);
          if (Number.isSafeInteger(cents) && cents > 0) { setThresholdPesewas(cents); setThresholdInput((cents / 100).toFixed(2)); }
        }
      } catch { setError("Browser storage is unavailable. Float balances remain visible, but this device cannot restore alert preferences."); }
      setLoading(false);
    }
    void initialize();
  }, [supabase]);

  useEffect(() => {
    if (!membership || !selectedAccountId || !floatAccounts.some((account) => account.id === selectedAccountId)) {
      movementRequestId.current += 1; setMovements([]); setMovementLoading(false); setMovementError(""); return;
    }
    void loadMovements(membership, selectedAccountId, boothFilter);
  }, [membership, selectedAccountId, boothFilter, floatAccounts, loadMovements]);

  function saveThreshold() {
    if (!membership) return;
    if (!thresholdInput.trim()) {
      try { window.localStorage.removeItem(`momo-ledger:float-alert:v1:${membership.business_id}`); }
      catch { setError("Browser storage is unavailable; the alert threshold could not be cleared from this device."); return; }
      setThresholdPesewas(null); setThresholdInput(""); return;
    }
    const cents = parsePesewas(thresholdInput);
    if (cents === null) { setError("Enter a positive threshold in Ghana cedis with no more than two decimal places."); return; }
    try { window.localStorage.setItem(`momo-ledger:float-alert:v1:${membership.business_id}`, String(cents)); }
    catch { setError("Browser storage is unavailable; this alert threshold could not be saved on this device."); return; }
    setThresholdPesewas(cents); setError("");
  }

  if (loading) return <p className="py-10 text-sm text-slate-500">Loading float accounts…</p>;
  const totalFloat = floatAccounts.reduce((total, account) => total + Number(account.current_balance_pesewas), 0);
  const lowAccounts = thresholdPesewas === null ? [] : floatAccounts.filter((account) => Number(account.current_balance_pesewas) <= thresholdPesewas);
  const selectedAccount = floatAccounts.find((account) => account.id === selectedAccountId);

  return <div className="space-y-6">
    <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="eyebrow">Network float</p><h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Float Management</h1><p className="mt-2 max-w-2xl text-sm text-slate-600">Monitor electronic float from configured financial accounts and review recent posted movements.</p></div><Link href="/cashbook" className="secondary-button w-fit">Open full cashbook</Link></header>
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
    {membership?.role === "OWNER" && booths.length > 1 && <label className="field max-w-sm"><span>Booth</span><select value={boothFilter} onChange={(event) => { setBoothFilter(event.target.value); setSelectedAccountId(""); }}><option value="">All booths</option>{booths.map((booth) => <option key={booth.id} value={booth.id}>{booth.name}</option>)}</select></label>}
    <section className="grid gap-4 sm:grid-cols-2"><article className="surface p-5"><p className="eyebrow">Electronic float</p><p className="mt-3 text-2xl font-black text-slate-950">{gh(totalFloat)}</p><p className="mt-1 text-xs text-slate-500">Combined configured balance for the selected booth scope; physical cash is excluded.</p></article><article className={`surface p-5 ${lowAccounts.length ? "border-amber-300 bg-amber-50" : ""}`}><p className="eyebrow">Low-float alerts</p><p className="mt-3 text-2xl font-black text-slate-950">{thresholdPesewas === null ? "Not set" : `${lowAccounts.length} account${lowAccounts.length === 1 ? "" : "s"}`}</p><p className="mt-1 text-xs text-slate-500">{thresholdPesewas === null ? "Choose a local alert threshold below." : `${lowAccounts.length} of ${floatAccounts.length} displayed network accounts are at or below ${gh(thresholdPesewas)}.`}</p></article></section>

    <section className="surface p-5"><div className="flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><p className="eyebrow">Alert preference</p><h2 className="mt-2 text-lg font-black text-slate-950">Low-float threshold</h2><p className="mt-1 max-w-xl text-sm text-slate-500">Set an informational threshold for the badges on this page. It is saved only in this browser and does not change financial records.</p></div><div className="flex flex-wrap items-end gap-2"><label className="field"><span>Threshold (GH₵)</span><input className="w-40" inputMode="decimal" placeholder="Not set" value={thresholdInput} onChange={(event) => setThresholdInput(event.target.value)} /></label><button type="button" className="primary-button" onClick={saveThreshold}>Save threshold</button>{thresholdPesewas !== null && <button type="button" className="secondary-button" onClick={() => { if (!membership) return; try { window.localStorage.removeItem(`momo-ledger:float-alert:v1:${membership.business_id}`); setThresholdInput(""); setThresholdPesewas(null); setError(""); } catch { setError("Browser storage is unavailable; the alert threshold could not be cleared from this device."); } }}>Clear</button>}</div></div></section>

    <section className="surface overflow-hidden"><div className="border-b border-slate-200 px-5 py-5"><p className="eyebrow">Configured accounts</p><h2 className="mt-2 text-lg font-black text-slate-950">Network float balances</h2></div>{floatAccounts.length === 0 ? <div className="p-10 text-center"><h3 className="font-bold text-slate-900">No electronic float accounts found</h3><p className="mt-2 text-sm text-slate-500">Complete or review business setup to configure network opening balances.</p><Link href="/setup" className="mt-4 inline-block text-sm font-bold text-sky-700">Open setup</Link></div> : <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">{floatAccounts.map((account) => { const isLow = thresholdPesewas !== null && Number(account.current_balance_pesewas) <= thresholdPesewas; const net = Number(account.current_balance_pesewas) - Number(account.opening_balance_pesewas); return <button type="button" key={account.id} onClick={() => setSelectedAccountId(account.id)} aria-pressed={selectedAccountId === account.id} className={`rounded-2xl border p-5 text-left transition ${selectedAccountId === account.id ? "border-sky-400 bg-sky-50" : isLow ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white hover:border-sky-200"}`}><div className="flex items-start justify-between gap-3"><div><p className="eyebrow">{account.network ? NETWORKS.find((item) => item.value === account.network)?.label ?? account.network : "Electronic float"}</p><p className="mt-1 text-xs text-slate-500">{label(account, booths)}</p></div>{isLow && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-900">Low float</span>}</div><p className="mt-5 text-2xl font-black text-slate-950">{gh(account.current_balance_pesewas)}</p><div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-200/80 pt-3 text-xs"><div><p className="text-slate-500">Opening balance</p><p className="mt-1 font-bold text-slate-800">{gh(account.opening_balance_pesewas)}</p></div><div><p className="text-slate-500">Net movement since opening</p><p className={`mt-1 font-bold ${net < 0 ? "text-rose-700" : "text-emerald-700"}`}>{net < 0 ? "−" : "+"}{gh(Math.abs(net))}</p></div></div></button>; })}</div>}</section>

    {selectedAccount && <section className="surface overflow-hidden"><div className="flex flex-col justify-between gap-3 border-b border-slate-200 p-5 sm:flex-row sm:items-center"><div><p className="eyebrow">{label(selectedAccount, booths)}</p><h2 className="mt-1 text-lg font-black text-slate-950">Recent ledger movements</h2></div><p className="text-xs text-slate-500">Latest 8 records · from the cashbook ledger</p></div>{movementError && <div role="alert" className="m-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">Could not load account movements: {movementError}</div>}{movementLoading ? <p className="p-8 text-sm text-slate-500">Loading ledger history…</p> : movements.length === 0 ? <p className="p-8 text-sm text-slate-500">No opening or posted ledger movements found for this account.</p> : <div className="divide-y divide-slate-100">{movements.map((movement) => <article key={movement.entry_id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"><div><p className="font-bold text-slate-900">{movement.description}</p><p className="mt-1 text-xs text-slate-500">{movement.internal_reference} · {new Date(movement.occurred_at).toLocaleString("en-GH", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Accra" })} · {movement.status}</p></div><div className="text-right"><p className={`font-bold ${Number(movement.money_in_pesewas) ? "text-emerald-700" : "text-rose-700"}`}>{Number(movement.money_in_pesewas) ? `+${gh(movement.money_in_pesewas)}` : Number(movement.money_out_pesewas) ? `−${gh(movement.money_out_pesewas)}` : "—"}</p><p className="mt-1 text-xs text-slate-500">Balance {gh(movement.running_balance_pesewas)}</p></div></article>)}</div>}</section>}
    <aside className="rounded-2xl border border-sky-200 bg-sky-50 p-5"><h2 className="font-black text-slate-950">Balances stay ledger-controlled</h2><p className="mt-1 text-sm leading-6 text-slate-700">This screen is read-only: it does not edit opening balances or write directly to account balances. Float transfers and manual adjustments need an authorized atomic ledger workflow; no such operation is currently exposed here. Record supported transactions or expenses through their existing workflows.</p></aside>
  </div>;
}
