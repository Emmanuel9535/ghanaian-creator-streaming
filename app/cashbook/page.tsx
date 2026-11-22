"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase";
import { gh } from "@/lib/transactions";

type Membership = { business_id: string; booth_id: string | null; role: "OWNER" | "ATTENDANT" };
type Booth = { id: string; name: string };
type Account = { id: string; account_code: string; account_category: string; network: string | null; booth_id: string | null };
type Entry = { entry_id: string; occurred_at: string; internal_reference: string; description: string; entry_type: string; account_id: string; account_code: string; account_category: string; network: string | null; money_in_pesewas: number; money_out_pesewas: number; running_balance_pesewas: number; recorded_by_name: string; status: string };
const PAGE_SIZE = 25;
const ENTRY_LABEL: Record<string, string> = { OPENING_BALANCE: "Opening balance", TRANSACTION_PRINCIPAL: "MoMo transaction", CUSTOMER_CHARGE: "Customer charge", COMMISSION: "Commission", ADJUSTMENT: "Adjustment", REVERSAL: "Reversal", EXPENSE: "Expense" };
function accountLabel(account: Pick<Account, "account_code" | "account_category" | "network">) {
  if (account.account_category === "PHYSICAL_CASH") return "Physical cash";
  if (account.account_category === "ELECTRONIC_FLOAT") return `${account.network ?? "Network"} float`;
  return account.account_code.replaceAll("_", " ");
}
function dayIso(value: Date) { const d = new Date(value); d.setHours(0, 0, 0, 0); return d.toISOString(); }
function getRange(range: string, from: string, to: string): { from: string | null; to: string | null } {
  const now = new Date();
  if (range === "all") return { from: null, to: null };
  if (range === "custom") {
    const start = from ? new Date(`${from}T00:00:00`) : null;
    const end = to ? new Date(`${to}T00:00:00`) : null;
    if (end) end.setDate(end.getDate() + 1);
    return { from: start?.toISOString() ?? null, to: end?.toISOString() ?? null };
  }
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  if (range === "yesterday") { start.setDate(start.getDate() - 1); }
  else if (range === "week") { const offset = (start.getDay() + 6) % 7; start.setDate(start.getDate() - offset); }
  else if (range === "month") { start.setDate(1); }
  if (range === "today" || range === "yesterday") end.setDate(start.getDate() + 1);
  else return { from: dayIso(start), to: now.toISOString() };
  return { from: dayIso(start), to: end.toISOString() };
}

export default function CashbookPage() {
  const supabase = useMemo(() => createClient(), []);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [booths, setBooths] = useState<Booth[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [more, setMore] = useState(false);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [range, setRange] = useState("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [accountId, setAccountId] = useState("");
  const [entryType, setEntryType] = useState("");
  const [boothId, setBoothId] = useState("");

  const queryPage = useCallback(async (m: Membership, pageIndex: number, filters: { range: string; from: string; to: string; accountId: string; entryType: string; boothId: string }) => {
    if (!supabase) return;
    const dates = getRange(filters.range, filters.from, filters.to);
    setLoading(true); setError("");
    const { data, error: rpcError } = await supabase.rpc("cashbook_page", {
      target_business_id: m.business_id,
      target_booth_id: m.role === "OWNER" ? filters.boothId || null : m.booth_id,
      target_account_id: filters.accountId || null,
      target_entry_type: filters.entryType || null,
      target_from: dates.from,
      target_to: dates.to,
      page_size: PAGE_SIZE + 1,
      page_offset: pageIndex * PAGE_SIZE,
    });
    if (rpcError) { setEntries([]); setMore(false); setError(rpcError.message); setLoading(false); return; }
    const rows = (data ?? []) as Entry[];
    setEntries(rows.slice(0, PAGE_SIZE)); setMore(rows.length > PAGE_SIZE); setLoading(false);
  }, [supabase]);

  useEffect(() => {
    async function initialize() {
      if (!supabase) { setError("Supabase is not configured for this application."); setLoading(false); return; }
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setError("Sign in to access the cashbook."); setLoading(false); return; }
      const { data: m, error: memberError } = await supabase.from("business_members").select("business_id,booth_id,role").eq("user_id", user.id).eq("status", "active").order("created_at", { ascending: true }).limit(1).maybeSingle();
      if (memberError || !m) { setError(memberError?.message ?? "No active business membership was found."); setLoading(false); return; }
      const member = m as Membership; setMembership(member);
      const [accountResult, boothResult] = await Promise.all([
        supabase.from("financial_accounts").select("id,account_code,account_category,network,booth_id").eq("business_id", member.business_id).order("account_category").order("network"),
        supabase.from("booths").select("id,name").eq("business_id", member.business_id).order("name"),
      ]);
      if (accountResult.error) setError(accountResult.error.message);
      if (boothResult.error) setError(boothResult.error.message);
      const accountList = ((accountResult.data ?? []) as Account[]).filter((a) => member.role === "OWNER" || a.booth_id === null || a.booth_id === member.booth_id);
      setAccounts(accountList); setBooths((boothResult.data ?? []) as Booth[]);
      await queryPage(member, 0, { range, from: customFrom, to: customTo, accountId, entryType, boothId });
    }
    void initialize();
  // Initial load only; filter changes are handled separately below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, queryPage]);

  useEffect(() => {
    if (!membership) return;
    setPage(0);
    void queryPage(membership, 0, { range, from: customFrom, to: customTo, accountId, entryType, boothId });
  }, [membership, range, customFrom, customTo, accountId, entryType, boothId, queryPage]);

  async function movePage(nextPage: number) {
    if (!membership) return;
    setPage(nextPage);
    await queryPage(membership, nextPage, { range, from: customFrom, to: customTo, accountId, entryType, boothId });
  }

  const selectedAccount = accounts.find((item) => item.id === accountId);
  const totalRowsOnPage = entries.length;
  return <div className="space-y-6">
    <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="eyebrow">Cash control</p><h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Cashbook</h1><p className="mt-2 max-w-2xl text-sm text-slate-600">A chronological view of recorded ledger movements. Each row is sourced from a posted ledger entry or the configured opening balance.</p></div><a href="/expenses" className="primary-button">Record expense</a></header>
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">Cashbook could not be loaded: {error}</div>}
    <section aria-label="Cashbook filters" className="surface grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      <label className="field"><span>Date range</span><select value={range} onChange={(e) => setRange(e.target.value)}><option value="today">Today</option><option value="yesterday">Yesterday</option><option value="week">This week</option><option value="month">This month</option><option value="custom">Custom range</option><option value="all">All dates</option></select></label>
      <label className="field"><span>Account</span><select value={accountId} onChange={(e) => setAccountId(e.target.value)}><option value="">All accounts</option>{accounts.map((a) => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}</select></label>
      <label className="field"><span>Movement type</span><select value={entryType} onChange={(e) => setEntryType(e.target.value)}><option value="">All movements</option>{Object.entries(ENTRY_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      {membership?.role === "OWNER" && <label className="field"><span>Booth</span><select value={boothId} onChange={(e) => setBoothId(e.target.value)}><option value="">All booths</option>{booths.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
      {range === "custom" && <><label className="field"><span>From</span><input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} /></label><label className="field"><span>To</span><input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} /></label></>}
    </section>
    <section className="surface overflow-hidden">
      <div className="flex flex-col justify-between gap-3 border-b border-slate-200 p-5 sm:flex-row sm:items-center"><div><p className="eyebrow">{selectedAccount ? accountLabel(selectedAccount) : "All configured accounts"}</p><h2 className="mt-1 text-lg font-black text-slate-950">Financial movements</h2></div><p className="text-xs text-slate-500">Money in and out are relative to the selected account. Commission and transaction principal remain separately labelled.</p></div>
      {loading ? <div className="p-10 text-sm text-slate-500">Loading ledger entries…</div> : entries.length === 0 ? <div className="p-12 text-center"><h3 className="font-bold text-slate-900">No ledger movements found</h3><p className="mt-2 text-sm text-slate-500">Try a wider date range or another account. Pending expenses are not included in the cashbook.</p></div> : <>
        <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[980px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Date / reference</th><th className="px-4 py-3">Description</th><th className="px-4 py-3">Type / account</th><th className="px-4 py-3 text-right">Money in</th><th className="px-4 py-3 text-right">Money out</th><th className="px-4 py-3 text-right">Running balance</th><th className="px-4 py-3">Recorded by / status</th></tr></thead><tbody className="divide-y divide-slate-100">{entries.map((entry) => <tr key={entry.entry_id} className="align-top"><td className="whitespace-nowrap px-5 py-4"><p className="font-semibold text-slate-900">{new Date(entry.occurred_at).toLocaleString("en-GH", { dateStyle: "medium", timeStyle: "short" })}</p><p className="mt-1 font-mono text-xs text-slate-500">{entry.internal_reference}</p></td><td className="max-w-xs px-4 py-4 text-slate-700">{entry.description}</td><td className="px-4 py-4"><p className="font-semibold text-slate-800">{ENTRY_LABEL[entry.entry_type] ?? entry.entry_type}</p><p className="mt-1 text-xs text-slate-500">{accountLabel(entry)}</p></td><td className="whitespace-nowrap px-4 py-4 text-right font-bold text-emerald-700">{Number(entry.money_in_pesewas) ? gh(entry.money_in_pesewas) : "—"}</td><td className="whitespace-nowrap px-4 py-4 text-right font-bold text-rose-700">{Number(entry.money_out_pesewas) ? gh(entry.money_out_pesewas) : "—"}</td><td className="whitespace-nowrap px-4 py-4 text-right font-black text-slate-950">{gh(entry.running_balance_pesewas)}</td><td className="px-4 py-4"><p className="text-slate-700">{entry.recorded_by_name || "Business member"}</p><p className="mt-1 text-xs text-slate-500">{entry.status}</p></td></tr>)}</tbody></table></div>
        <div className="divide-y divide-slate-100 md:hidden">{entries.map((entry) => <article key={entry.entry_id} className="space-y-3 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-slate-900">{ENTRY_LABEL[entry.entry_type] ?? entry.entry_type}</p><p className="mt-1 text-xs text-slate-500">{new Date(entry.occurred_at).toLocaleString("en-GH", { dateStyle: "medium", timeStyle: "short" })} · {entry.internal_reference}</p></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">{entry.status}</span></div><p className="text-sm text-slate-600">{entry.description}</p><p className="text-xs text-slate-500">{accountLabel(entry)} · {entry.recorded_by_name}</p><div className="grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 text-xs"><div><p className="text-slate-500">Money in</p><p className="mt-1 font-bold text-emerald-700">{Number(entry.money_in_pesewas) ? gh(entry.money_in_pesewas) : "—"}</p></div><div><p className="text-slate-500">Money out</p><p className="mt-1 font-bold text-rose-700">{Number(entry.money_out_pesewas) ? gh(entry.money_out_pesewas) : "—"}</p></div><div><p className="text-slate-500">Balance</p><p className="mt-1 font-black text-slate-950">{gh(entry.running_balance_pesewas)}</p></div></div></article>)}</div>
      </>}
      <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3"><p className="text-xs text-slate-500">Page {page + 1} · {totalRowsOnPage} entries shown · limited database page</p><div className="flex gap-2"><button className="secondary-button" disabled={page === 0 || loading} onClick={() => void movePage(page - 1)}>Previous</button><button className="secondary-button" disabled={!more || loading} onClick={() => void movePage(page + 1)}>Next</button></div></div>
    </section>
    <p className="text-xs leading-5 text-slate-500">Balances on this page are the ledger’s stored resulting account balances. Opening balances are shown from configured financial accounts. This view does not calculate revenue or profit and does not include pending expenses.</p>
  </div>;
}
