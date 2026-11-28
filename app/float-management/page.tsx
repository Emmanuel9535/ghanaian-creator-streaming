"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, WalletCards, ArrowDownLeft, ArrowUpRight, Activity, ShieldAlert } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { gh, networkLabel } from "@/lib/transactions";
import { resolveActiveWorkspace, type ActiveWorkspace } from "@/lib/workspace";

type Account = {
  id: string;
  account_code: string;
  account_category: string;
  network: string | null;
  booth_id: string | null;
  opening_balance_pesewas: number;
  current_balance_pesewas: number;
};

type LedgerEntry = {
  id: string;
  account_id: string;
  entry_type: string;
  balance_delta_pesewas: number;
  resulting_balance_pesewas: number;
  description: string;
  created_at: string;
};

type Dashboard = {
  activity?: {
    successful_deposit_volume_pesewas?: number;
    successful_withdrawal_volume_pesewas?: number;
    airtime_volume_pesewas?: number;
    bill_payment_volume_pesewas?: number;
    commission_earned_pesewas?: number;
    commission_received_pesewas?: number;
    pending_transactions?: number;
    requires_review?: number;
  };
};

function accountLabel(account: Account) {
  if (account.account_category === "PHYSICAL_CASH") return "Physical cash";
  if (account.network) return networkLabel(account.network);
  return account.account_code.replaceAll("_", " ");
}

function isVisibleToWorkspace(account: Account, workspace: ActiveWorkspace) {
  return workspace.role === "OWNER" || account.booth_id === null || account.booth_id === workspace.booth?.id;
}

export default function FloatManagementPage() {
  const supabase = useMemo(() => createClient(), []);
  const [workspace, setWorkspace] = useState<ActiveWorkspace | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!supabase) {
      setError("Supabase is not configured for this application.");
      setLoading(false);
      return;
    }
    setRefreshing(true);
    setError("");
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      setError(userError?.message ?? "Sign in to view float management.");
      setLoading(false);
      setRefreshing(false);
      return;
    }
    const resolution = await resolveActiveWorkspace(supabase, userData.user.id);
    if (resolution.error || !resolution.workspace) {
      setError(resolution.error ?? "No active business workspace was found.");
      setLoading(false);
      setRefreshing(false);
      return;
    }
    const current = resolution.workspace;
    setWorkspace(current);
    const [accountResult, entryResult, dashboardResult] = await Promise.all([
      supabase.from("financial_accounts").select("id,account_code,account_category,network,booth_id,opening_balance_pesewas,current_balance_pesewas").eq("business_id", current.business.id).order("account_category").order("network"),
      supabase.from("ledger_entries").select("id,account_id,entry_type,balance_delta_pesewas,resulting_balance_pesewas,description,created_at").eq("business_id", current.business.id).order("created_at", { ascending: false }).limit(12),
      supabase.rpc("financial_dashboard", { target_business_id: current.business.id, target_booth_id: current.role === "OWNER" ? null : current.booth?.id ?? null }),
    ]);
    const firstError = accountResult.error ?? entryResult.error ?? dashboardResult.error;
    if (firstError) setError(firstError.message);
    setAccounts(((accountResult.data ?? []) as Account[]).filter((account) => isVisibleToWorkspace(account, current)));
    setEntries((entryResult.data ?? []) as LedgerEntry[]);
    setDashboard((dashboardResult.data ?? null) as Dashboard | null);
    setLoading(false);
    setRefreshing(false);
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);

  const floatAccounts = accounts.filter((account) => account.account_category === "ELECTRONIC_FLOAT");
  const cashAccount = accounts.find((account) => account.account_category === "PHYSICAL_CASH");
  const totalBalance = accounts.reduce((sum, account) => sum + Number(account.current_balance_pesewas ?? 0), 0);
  const activity = dashboard?.activity ?? {};
  const accountById = new Map(accounts.map((account) => [account.id, account]));

  if (loading) return <div className="surface p-6 text-sm text-[var(--muted)]">Loading float details…</div>;

  return <div className="space-y-7">
    <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><p className="eyebrow">Network float</p><h1 className="mt-2 text-3xl font-black tracking-tight text-[var(--teal-dark)]">Float Management</h1><p className="mt-2 text-sm leading-6 text-[var(--muted)]">See current balances, opening positions and the latest posted movements for {workspace?.business.name ?? "your business"}.</p></div>
      <button onClick={() => void load()} disabled={refreshing} className="secondary-button w-fit"><RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />{refreshing ? "Refreshing…" : "Refresh details"}</button>
    </section>
    {error && <div role="alert" className="flex gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><ShieldAlert size={18} className="mt-0.5 shrink-0" /><span>{error}</span></div>}
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <div className="surface p-5"><div className="flex items-center justify-between"><p className="text-sm font-semibold text-[var(--muted)]">Total tracked balance</p><WalletCards className="text-[var(--teal)]" size={20} /></div><p className="mt-3 text-2xl font-black text-[var(--teal-dark)]">{gh(totalBalance)}</p><p className="mt-1 text-xs text-[var(--muted)]">Cash and visible network float accounts</p></div>
      <div className="surface p-5"><p className="text-sm font-semibold text-[var(--muted)]">Money received</p><p className="mt-3 text-2xl font-black text-emerald-700">{gh(activity.successful_deposit_volume_pesewas)}</p><p className="mt-1 text-xs text-[var(--muted)]">Successful deposits</p></div>
      <div className="surface p-5"><p className="text-sm font-semibold text-[var(--muted)]">Money paid out</p><p className="mt-3 text-2xl font-black text-rose-700">{gh(activity.successful_withdrawal_volume_pesewas)}</p><p className="mt-1 text-xs text-[var(--muted)]">Successful withdrawals</p></div>
      <div className="surface p-5"><p className="text-sm font-semibold text-[var(--muted)]">Pending review</p><p className="mt-3 text-2xl font-black text-[var(--teal-dark)]">{activity.pending_transactions ?? 0}</p><p className="mt-1 text-xs text-[var(--muted)]">Transactions awaiting completion</p></div>
    </section>
    <section className="surface overflow-hidden"><div className="border-b border-[var(--line)] px-5 py-5 sm:px-6"><p className="eyebrow">Account balances</p><h2 className="mt-1 text-xl font-black text-[var(--teal-dark)]">Opening and current positions</h2></div>{accounts.length === 0 ? <div className="p-10 text-center text-sm text-[var(--muted)]">No financial accounts have been created for this workspace yet.</div> : <div className="overflow-x-auto"><table className="data-table"><thead><tr><th>Account</th><th>Network</th><th>Opening balance</th><th>Current balance</th><th>Movement</th></tr></thead><tbody>{cashAccount && <tr><td className="font-bold">{accountLabel(cashAccount)}</td><td>—</td><td>{gh(cashAccount.opening_balance_pesewas)}</td><td className="font-black">{gh(cashAccount.current_balance_pesewas)}</td><td className={cashAccount.current_balance_pesewas - cashAccount.opening_balance_pesewas >= 0 ? "text-emerald-700" : "text-rose-700"}>{gh(cashAccount.current_balance_pesewas - cashAccount.opening_balance_pesewas)}</td></tr>}{floatAccounts.map((account) => <tr key={account.id}><td className="font-bold">{accountLabel(account)}</td><td>{account.network ?? "—"}</td><td>{gh(account.opening_balance_pesewas)}</td><td className="font-black">{gh(account.current_balance_pesewas)}</td><td className={account.current_balance_pesewas - account.opening_balance_pesewas >= 0 ? "text-emerald-700" : "text-rose-700"}>{gh(account.current_balance_pesewas - account.opening_balance_pesewas)}</td></tr>)}</tbody></table></div>}</section>
    <section className="grid gap-5 lg:grid-cols-[.8fr_1.2fr]"><div className="surface p-5 sm:p-6"><div className="flex items-center justify-between"><div><p className="eyebrow">Operating activity</p><h2 className="mt-1 text-xl font-black text-[var(--teal-dark)]">Movement summary</h2></div><Activity size={21} className="text-[var(--teal)]" /></div><dl className="mt-5 space-y-3 text-sm"><div className="flex justify-between gap-3"><dt className="text-[var(--muted)]">Airtime volume</dt><dd className="font-bold">{gh(activity.airtime_volume_pesewas)}</dd></div><div className="flex justify-between gap-3"><dt className="text-[var(--muted)]">Bill payments</dt><dd className="font-bold">{gh(activity.bill_payment_volume_pesewas)}</dd></div><div className="flex justify-between gap-3"><dt className="text-[var(--muted)]">Commission earned</dt><dd className="font-bold text-emerald-700">{gh(activity.commission_earned_pesewas)}</dd></div><div className="flex justify-between gap-3"><dt className="text-[var(--muted)]">Requires review</dt><dd className="font-bold text-amber-700">{activity.requires_review ?? 0}</dd></div></dl></div><div className="surface overflow-hidden"><div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-5 sm:px-6"><div><p className="eyebrow">Ledger activity</p><h2 className="mt-1 text-xl font-black text-[var(--teal-dark)]">Latest balance movements</h2></div><span className="text-xs font-semibold text-[var(--muted)]">Latest 12</span></div>{entries.length === 0 ? <div className="p-10 text-center text-sm text-[var(--muted)]">No ledger movements have been posted yet.</div> : <div className="divide-y divide-[#edf0f1]">{entries.map((entry) => { const account = accountById.get(entry.account_id); const positive = Number(entry.balance_delta_pesewas) >= 0; return <div key={entry.id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"><div className="flex min-w-0 items-start gap-3"><span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl ${positive ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{positive ? <ArrowDownLeft size={17} /> : <ArrowUpRight size={17} />}</span><div className="min-w-0"><p className="truncate font-bold text-[var(--ink)]">{entry.description}</p><p className="mt-1 text-xs text-[var(--muted)]">{account ? accountLabel(account) : "Account"} · {entry.entry_type} · {new Date(entry.created_at).toLocaleString("en-GH", { dateStyle: "medium", timeStyle: "short" })}</p></div></div><div className="pl-12 text-left sm:pl-0 sm:text-right"><p className={`font-black ${positive ? "text-emerald-700" : "text-rose-700"}`}>{positive ? "+" : "−"}{gh(Math.abs(Number(entry.balance_delta_pesewas)))}</p><p className="text-xs text-[var(--muted)]">Balance {gh(entry.resulting_balance_pesewas)}</p></div></div>; })}</div>}</div></section>
  </div>;
}
