"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase";
import { enqueueFloatMovement, flushFloatQueue, getFloatQueue, newFloatRequestId, type FloatMovementKind, type QueuedFloatMovement } from "@/lib/float-offline";

type Account = { id: string; account_code: string; account_category: string; network: string | null; opening_balance_pesewas: number; current_balance_pesewas: number };
type Balance = { account_id: string; opening_balance_pesewas: number; total_money_in_pesewas: number; total_money_out_pesewas: number; closing_balance_pesewas: number };
type Movement = { entry_id: string; occurred_at: string; internal_reference: string; description: string; entry_type: string; account_id: string; account_code: string; network: string | null; money_in_pesewas: number; money_out_pesewas: number; running_balance_pesewas: number; recorded_by_name: string; status: string };
type Threshold = { account_id: string; threshold_pesewas: number };

const NETWORKS = [
  { key: "MTN", label: "MTN MoMo" },
  { key: "TELECEL", label: "Telecel Cash" },
  { key: "AT", label: "AT Money" },
];

function gh(value: number) { return `GH₵ ${(Number(value || 0) / 100).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function amountToPesewas(value: string) { const number = Number(value); return Number.isFinite(number) && number > 0 ? Math.round(number * 100) : NaN; }
function accountLabel(account: Account) { return account.account_category === "PHYSICAL_CASH" ? "Physical cash" : NETWORKS.find((network) => network.key === account.network)?.label || account.account_code; }
function todayStart() { const date = new Date(); date.setHours(0, 0, 0, 0); return date.toISOString(); }

export default function FloatManagementPage() {
  const supabase = useMemo(() => createClient(), []);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [boothId, setBoothId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [balances, setBalances] = useState<Record<string, Balance>>({});
  const [thresholds, setThresholds] = useState<Record<string, number>>({});
  const [queue, setQueue] = useState<QueuedFloatMovement[]>([]);
  const [history, setHistory] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [movement, setMovement] = useState<FloatMovementKind>("DEPOSIT");
  const [sourceId, setSourceId] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [historyAccount, setHistoryAccount] = useState("");

  const loadWorkspace = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { window.location.href = "/auth"; return; }
    const { data: membership, error: membershipError } = await supabase.from("business_members").select("business_id,booth_id").eq("user_id", user.id).eq("status", "active").order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (membershipError || !membership?.business_id || !membership?.booth_id) { setNotice({ type: "error", text: membershipError?.message || "Complete business and booth setup before managing float." }); setLoading(false); return; }
    setBusinessId(membership.business_id); setBoothId(membership.booth_id);
    const [{ data: accountRows, error: accountError }, { data: thresholdRows, error: thresholdError }, balanceResult] = await Promise.all([
      supabase.from("financial_accounts").select("id,account_code,account_category,network,opening_balance_pesewas,current_balance_pesewas").eq("business_id", membership.business_id).or(`booth_id.is.null,booth_id.eq.${membership.booth_id}`).order("account_category").order("network"),
      supabase.from("float_thresholds").select("account_id,threshold_pesewas").eq("business_id", membership.business_id).eq("booth_id", membership.booth_id),
      supabase.rpc("cashbook_account_balances", { target_business_id: membership.business_id, target_booth_id: membership.booth_id, target_account_id: null, target_from: null, target_to: null }),
    ]);
    if (accountError) { setNotice({ type: "error", text: accountError.message }); setLoading(false); return; }
    if (thresholdError) setNotice({ type: "error", text: "Float thresholds are not available until the database migration is applied." });
    if (balanceResult.error) setNotice({ type: "error", text: `Float balances could not be loaded: ${balanceResult.error.message}` });
    setAccounts((accountRows ?? []) as Account[]);
    const balanceMap: Record<string, Balance> = {};
    ((balanceResult.data ?? []) as Balance[]).forEach((item) => { balanceMap[item.account_id] = item; });
    setBalances(balanceMap);
    const thresholdMap: Record<string, number> = {};
    ((thresholdRows ?? []) as Threshold[]).forEach((item) => { thresholdMap[item.account_id] = item.threshold_pesewas; });
    setThresholds(thresholdMap);
    const firstNetwork = (accountRows ?? []).find((item: Account) => item.account_category === "ELECTRONIC_FLOAT");
    const firstAccount = (accountRows ?? []).find((item: Account) => item.account_category === "PHYSICAL_CASH") || firstNetwork;
    setSourceId(firstAccount?.id || "");
    setLoading(false);
  }, [supabase]);

  const loadHistory = useCallback(async () => {
    if (!supabase || !businessId || !boothId) return;
    setHistoryLoading(true);
    const { data, error } = await supabase.rpc("cashbook_page_v2", {
      target_business_id: businessId, target_booth_id: boothId, target_account_id: historyAccount || null,
      target_entry_type: null, target_status: null, target_search: search.trim() || null,
      target_from: fromDate ? new Date(`${fromDate}T00:00:00`).toISOString() : null,
      target_to: toDate ? new Date(`${toDate}T23:59:59.999`).toISOString() : null,
      target_sort: "newest", page_size: 100, page_offset: 0,
    });
    if (error) setNotice({ type: "error", text: error.message });
    setHistory((data ?? []) as Movement[]);
    setHistoryLoading(false);
  }, [supabase, businessId, boothId, historyAccount, search, fromDate, toDate]);

  const refresh = useCallback(async () => { await loadWorkspace(); await loadHistory(); }, [loadWorkspace, loadHistory]);
  useEffect(() => {
    loadWorkspace().catch((error: unknown) => {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "Float Management could not load. Please reload and try again." });
      setLoading(false);
    });
    setQueue(getFloatQueue());
  }, [loadWorkspace]);
  useEffect(() => { if (businessId && boothId) loadHistory(); }, [businessId, boothId, loadHistory]);
  useEffect(() => {
    const sync = async () => { if (!supabase) return; await flushFloatQueue(supabase); setQueue(getFloatQueue()); await refresh(); };
    const onQueue = () => setQueue(getFloatQueue());
    window.addEventListener("online", sync); window.addEventListener("float-queue-changed", onQueue); sync();
    return () => { window.removeEventListener("online", sync); window.removeEventListener("float-queue-changed", onQueue); };
  }, [supabase, refresh]);

  const movementAccounts = accounts.filter((account) => account.account_category === "PHYSICAL_CASH" || account.account_category === "ELECTRONIC_FLOAT");
  const networkAccounts = accounts.filter((account) => account.account_category === "ELECTRONIC_FLOAT");
  const provisionalDelta = (accountId: string) => queue.filter((item) => item.accountId === accountId || item.destinationAccountId === accountId).reduce((total, item) => {
    if (item.movementType === "TRANSFER") return total + (item.destinationAccountId === accountId ? item.amountPesewas : -item.amountPesewas);
    if (item.accountId !== accountId) return total;
    return total + (item.movementType === "WITHDRAWAL" ? -item.amountPesewas : item.amountPesewas);
  }, 0);

  async function submitMovement(event: FormEvent) {
    event.preventDefault(); setNotice(null);
    if (!supabase || !businessId || !boothId || !sourceId) return;
    const amountPesewas = amountToPesewas(amount);
    if (!Number.isInteger(amountPesewas)) { setNotice({ type: "error", text: "Enter an amount greater than zero." }); return; }
    if (movement === "TRANSFER" && (!destinationId || destinationId === sourceId)) { setNotice({ type: "error", text: "Choose a different destination account." }); return; }
    const item = { requestId: newFloatRequestId(), businessId, boothId, accountId: sourceId, destinationAccountId: movement === "TRANSFER" ? destinationId : null, movementType: movement, amountPesewas, description: description.trim(), queuedAt: new Date().toISOString() } satisfies QueuedFloatMovement;
    setBusy(true);
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      enqueueFloatMovement(item); setQueue(getFloatQueue()); setNotice({ type: "success", text: "Saved offline. This movement is provisional and will sync automatically when you reconnect." });
    } else {
      const { error } = await supabase.rpc("record_float_movement", { target_business_id: businessId, target_booth_id: boothId, target_account_id: sourceId, target_movement_type: movement, target_amount_pesewas: amountPesewas, target_description: description.trim() || null, request_id: item.requestId, target_destination_account_id: movement === "TRANSFER" ? destinationId : null });
      if (error) setNotice({ type: "error", text: error.message }); else { setNotice({ type: "success", text: "Float movement recorded with an atomic ledger posting." }); setAmount(""); setDescription(""); await refresh(); }
    }
    setBusy(false);
  }

  async function saveThreshold(accountId: string, value: string) {
    if (!supabase || !businessId || !boothId) return;
    const thresholdPesewas = Number.isFinite(Number(value)) && Number(value) >= 0 ? Math.round(Number(value) * 100) : NaN;
    if (!Number.isInteger(thresholdPesewas)) { setNotice({ type: "error", text: "Enter a valid non-negative threshold." }); return; }
    const { error } = await supabase.rpc("set_float_threshold", { target_business_id: businessId, target_booth_id: boothId, target_account_id: accountId, target_threshold_pesewas: thresholdPesewas });
    if (error) setNotice({ type: "error", text: error.message }); else { setThresholds((current) => ({ ...current, [accountId]: thresholdPesewas })); setNotice({ type: "success", text: "Low-float threshold saved with an audit record." }); }
  }

  if (loading) return <main className="mx-auto max-w-7xl py-16"><p className="eyebrow">Network float</p><p className="mt-4 text-sm text-slate-500">Loading your float controls…</p></main>;
  if (!supabase) return <main className="mx-auto max-w-3xl py-16"><div className="surface p-8"><p className="eyebrow">Network float</p><h1 className="mt-3 text-3xl font-black">Supabase is not configured</h1><p className="mt-3 text-sm text-slate-500">Configure the public Supabase URL and anonymous key to manage float securely.</p></div></main>;

  return <div className="space-y-7">
    <section className="flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><p className="eyebrow">Network float</p><h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Float Management</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">Keep physical cash and each network float separate, record every movement, and see the balance that is actually available at the booth.</p></div><div className={`rounded-full px-3 py-2 text-xs font-bold ${queue.length ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>{queue.length ? `${queue.length} provisional movement${queue.length === 1 ? "" : "s"} pending sync` : "All movements synced"}</div></section>
    {notice && <div role="status" className={`rounded-xl border px-4 py-3 text-sm ${notice.type === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{notice.text}</div>}
    {movementAccounts.length === 0 ? <section className="surface p-6"><p className="eyebrow">No float accounts found</p><h2 className="mt-2 text-xl font-black text-slate-950">Finish your booth setup first</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">Float Management needs the physical cash and network accounts created during workspace setup. Open setup, confirm your booth and opening balances, then return here.</p><a href="/setup" className="primary-button mt-5 inline-flex">Open workspace setup</a></section> : <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{movementAccounts.map((account) => { const summary = balances[account.id]; const threshold = thresholds[account.id]; const available = Number(summary?.closing_balance_pesewas ?? account.current_balance_pesewas ?? 0) + provisionalDelta(account.id); const low = account.account_category === "ELECTRONIC_FLOAT" && threshold !== undefined && available < threshold; return <article key={account.id} className={`surface p-5 ${low ? "border-amber-300 ring-1 ring-amber-200" : ""}`}><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-bold text-slate-600">{accountLabel(account)}</p><p className="mt-3 text-2xl font-black text-slate-950">{gh(available)}</p></div><span className={`rounded-full px-2 py-1 text-[11px] font-black ${low ? "bg-amber-100 text-amber-800" : "bg-sky-50 text-sky-700"}`}>{low ? "Low float" : "Available"}</span></div><div className="mt-5 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 text-xs"><p><span className="block text-slate-500">Opening</span><strong className="mt-1 block text-slate-900">{gh(Number(summary?.opening_balance_pesewas ?? account.opening_balance_pesewas))}</strong></p><p><span className="block text-slate-500">Money in</span><strong className="mt-1 block text-emerald-700">{gh(Number(summary?.total_money_in_pesewas ?? 0))}</strong></p><p><span className="block text-slate-500">Money out</span><strong className="mt-1 block text-red-700">{gh(Number(summary?.total_money_out_pesewas ?? 0))}</strong></p><p><span className="block text-slate-500">Closing</span><strong className="mt-1 block text-slate-900">{gh(available)}</strong></p></div>{low && <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">Below your {gh(threshold)} minimum threshold.</p>}{provisionalDelta(account.id) !== 0 && <p className="mt-3 text-xs font-bold text-amber-700">Includes provisional offline movement.</p>}</article>; })}</section>}
    <section className="grid gap-6 xl:grid-cols-[.8fr_1.2fr]">
      <form onSubmit={submitMovement} className="surface p-5 sm:p-6"><div><p className="eyebrow">Record movement</p><h2 className="mt-2 text-xl font-black text-slate-950">Add float movement</h2><p className="mt-2 text-sm leading-6 text-slate-500">Deposits, withdrawals and adjustments affect one account. Transfers debit and credit both accounts in one posting.</p></div><div className="mt-5 space-y-4"><label className="field"><span>Movement type</span><select value={movement} onChange={(e) => setMovement(e.target.value as FloatMovementKind)}><option value="DEPOSIT">Deposit</option><option value="WITHDRAWAL">Withdrawal</option><option value="ADJUSTMENT">Adjustment</option><option value="TRANSFER">Transfer</option></select></label><label className="field"><span>{movement === "TRANSFER" ? "From account" : "Account"}</span><select required value={sourceId} onChange={(e) => setSourceId(e.target.value)}>{movementAccounts.map((account) => <option key={account.id} value={account.id}>{accountLabel(account)}</option>)}</select></label>{movement === "TRANSFER" && <label className="field"><span>To account</span><select required value={destinationId} onChange={(e) => setDestinationId(e.target.value)}><option value="">Choose destination</option>{movementAccounts.filter((account) => account.id !== sourceId).map((account) => <option key={account.id} value={account.id}>{accountLabel(account)}</option>)}</select></label>}<label className="field"><span>Amount <em>(GH₵)</em></span><input required inputMode="decimal" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></label><label className="field"><span>Description <em>(optional)</em></span><textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Cash replenishment from owner" /></label><button disabled={busy} className="primary-button w-full">{busy ? "Saving…" : typeof navigator !== "undefined" && !navigator.onLine ? "Save offline" : "Record movement"}</button></div></form>
      <div className="surface p-5 sm:p-6"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="eyebrow">Low-float controls</p><h2 className="mt-2 text-xl font-black text-slate-950">Minimum thresholds</h2><p className="mt-2 text-sm text-slate-500">Alerts are calculated from the live or provisional available balance. Every change is audited.</p></div></div><div className="mt-5 divide-y divide-slate-100">{networkAccounts.map((account) => <div key={account.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-bold text-slate-900">{accountLabel(account)}</p><p className="mt-1 text-xs text-slate-500">Alert when available float falls below this amount.</p></div><div className="flex gap-2"><div className="relative"><span className="pointer-events-none absolute left-3 top-3 text-xs text-slate-400">GH₵</span><input aria-label={`${accountLabel(account)} minimum threshold`} className="min-h-11 w-36 rounded-xl border border-slate-200 pl-10 pr-3 text-sm" type="number" min="0" step="0.01" defaultValue={thresholds[account.id] === undefined ? "" : (thresholds[account.id] / 100).toFixed(2)} placeholder="0.00" id={`threshold-${account.id}`} /></div><button type="button" className="secondary-button" onClick={() => { const input = document.getElementById(`threshold-${account.id}`) as HTMLInputElement | null; if (input) saveThreshold(account.id, input.value); }}>Save</button></div></div>)}</div><div className="mt-5 rounded-xl bg-sky-50 p-4 text-sm text-slate-700"><strong>Opening balances</strong><p className="mt-1 leading-6">The four opening balances are preserved from workspace setup and are never overwritten here. Future corrections must be recorded as an authorised adjustment.</p></div></div>
    </section>
    <section className="surface overflow-hidden"><div className="border-b border-slate-200 p-5 sm:p-6"><div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end"><div><p className="eyebrow">Audit trail</p><h2 className="mt-2 text-xl font-black text-slate-950">Float movement history</h2><p className="mt-2 text-sm text-slate-500">Opening balance, money in, money out and closing balance are available per account above.</p></div><button type="button" onClick={async () => { await flushFloatQueue(supabase); setQueue(getFloatQueue()); await refresh(); }} className="secondary-button w-fit">Sync now</button></div><form onSubmit={(event) => { event.preventDefault(); loadHistory(); }} className="mt-5 grid gap-3 md:grid-cols-[1fr_160px_160px_180px_auto]"><input aria-label="Search float history" placeholder="Search reference or description" value={search} onChange={(e) => setSearch(e.target.value)} /><input aria-label="History from date" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /><input aria-label="History to date" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /><select aria-label="Filter history account" value={historyAccount} onChange={(e) => setHistoryAccount(e.target.value)}><option value="">All accounts</option>{movementAccounts.map((account) => <option key={account.id} value={account.id}>{accountLabel(account)}</option>)}</select><button className="secondary-button" type="submit">Filter</button></form></div><div className="overflow-x-auto">{historyLoading ? <p className="p-8 text-sm text-slate-500">Loading movement history…</p> : <table className="w-full min-w-[980px] text-left text-sm"><thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-4">Date / reference</th><th className="px-5 py-4">Account</th><th className="px-5 py-4">Description</th><th className="px-5 py-4">Money in</th><th className="px-5 py-4">Money out</th><th className="px-5 py-4">Balance</th><th className="px-5 py-4">Status</th></tr></thead><tbody className="divide-y divide-slate-100">{history.length === 0 ? <tr><td colSpan={7} className="px-5 py-12 text-center text-sm text-slate-500">No movements match these filters.</td></tr> : history.map((row) => <tr key={row.entry_id} className="hover:bg-sky-50/40"><td className="px-5 py-4"><strong className="text-slate-900">{row.internal_reference}</strong><span className="mt-1 block text-xs text-slate-500">{new Date(row.occurred_at).toLocaleString("en-GH", { dateStyle: "medium", timeStyle: "short" })}</span></td><td className="px-5 py-4 font-semibold text-slate-800">{row.network ? accountLabel({ network: row.network, account_category: "ELECTRONIC_FLOAT", account_code: row.account_code } as Account) : "Physical cash"}</td><td className="max-w-xs px-5 py-4 text-slate-600">{row.description}<span className="mt-1 block text-xs text-slate-400">{row.recorded_by_name}</span></td><td className="px-5 py-4 font-bold text-emerald-700">{row.money_in_pesewas ? gh(row.money_in_pesewas) : "—"}</td><td className="px-5 py-4 font-bold text-red-700">{row.money_out_pesewas ? gh(row.money_out_pesewas) : "—"}</td><td className="px-5 py-4 font-bold text-slate-900">{gh(row.running_balance_pesewas)}</td><td className="px-5 py-4"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">{row.status}</span></td></tr>)}</tbody></table>}</div></section>
    <p className="text-xs leading-5 text-slate-500">Balances are stored as integer pesewas. Offline entries remain provisional until the server accepts the same idempotency key; historical postings are append-only.</p>
  </div>;
}
