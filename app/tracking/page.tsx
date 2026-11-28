"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Activity, ArrowDownLeft, ArrowUpRight, Bell, BellOff, RefreshCw, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { gh, maskPhone, networkLabel, typeLabel } from "@/lib/transactions";
import { resolveActiveWorkspace, type ActiveWorkspace } from "@/lib/workspace";

type Transaction = { id: string; internal_reference: string; network: string; transaction_type: string; principal_amount_pesewas: number; transaction_status: string; customer_phone: string; transaction_at: string; booth_id: string };
type StatusHistory = { id: string; transaction_id: string; from_status: string | null; to_status: string; reason: string | null; changed_by: string; created_at: string };
type LedgerEntry = { id: string; entry_type: string; balance_delta_pesewas: number; resulting_balance_pesewas: number; description: string; created_at: string };
type CapturedNotification = { id: string; packageName: string; title: string; text: string; postedAt: number; capturedAt: number };
type NotificationTrackingPlugin = { getStatus: () => Promise<{ available: boolean; enabled: boolean }>; openSettings: () => Promise<void>; getCapturedNotifications: () => Promise<{ items: CapturedNotification[] }> };

declare global {
  interface Window { Capacitor?: { Plugins?: { NotificationTracking?: NotificationTrackingPlugin } } }
}

const badge = (status: string) => status === "SUCCESSFUL" || status === "POSTED" ? "bg-emerald-50 text-emerald-700" : status === "FAILED" || status === "REVERSED" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700";

export default function TrackingPage() {
  const supabase = useMemo(() => createClient(), []);
  const [workspace, setWorkspace] = useState<ActiveWorkspace | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [history, setHistory] = useState<StatusHistory[]>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notificationItems, setNotificationItems] = useState<CapturedNotification[]>([]);
  const [notificationAvailable, setNotificationAvailable] = useState(false);
  const [notificationEnabled, setNotificationEnabled] = useState(false);

  const loadNotifications = useCallback(async () => {
    const plugin = typeof window === "undefined" ? undefined : window.Capacitor?.Plugins?.NotificationTracking;
    if (!plugin) return;
    const statusResult = await plugin.getStatus();
    setNotificationAvailable(statusResult.available);
    setNotificationEnabled(statusResult.enabled);
    const captured = await plugin.getCapturedNotifications();
    setNotificationItems(captured.items ?? []);
  }, []);

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
      setError(userError?.message ?? "Sign in to view tracking.");
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
    const [txResult, historyResult, ledgerResult] = await Promise.all([
      supabase.from("transactions").select("id,internal_reference,network,transaction_type,principal_amount_pesewas,transaction_status,customer_phone,transaction_at,booth_id").eq("business_id", current.business.id).order("transaction_at", { ascending: false }).limit(100),
      supabase.from("transaction_status_history").select("id,transaction_id,from_status,to_status,reason,changed_by,created_at").eq("business_id", current.business.id).order("created_at", { ascending: false }).limit(100),
      supabase.from("ledger_entries").select("id,entry_type,balance_delta_pesewas,resulting_balance_pesewas,description,created_at").eq("business_id", current.business.id).order("created_at", { ascending: false }).limit(100),
    ]);
    const firstError = txResult.error ?? historyResult.error ?? ledgerResult.error;
    if (firstError) setError(firstError.message);
    setTransactions((txResult.data ?? []) as Transaction[]);
    setHistory((historyResult.data ?? []) as StatusHistory[]);
    setLedger((ledgerResult.data ?? []) as LedgerEntry[]);
    setLoading(false);
    setRefreshing(false);
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadNotifications(); }, [loadNotifications]);

  const visibleTransactions = transactions.filter((row) => {
    const haystack = `${row.internal_reference} ${row.network} ${row.transaction_type} ${row.customer_phone}`.toLowerCase();
    return (status === "ALL" || row.transaction_status === status) && (!query.trim() || haystack.includes(query.trim().toLowerCase()));
  });
  const successful = transactions.filter((row) => row.transaction_status === "SUCCESSFUL").length;
  const pending = transactions.filter((row) => row.transaction_status === "PENDING").length;
  const failed = transactions.filter((row) => row.transaction_status === "FAILED").length;

  if (loading) return <div className="surface p-6 text-sm text-[var(--muted)]">Loading tracking details…</div>;

  return <div className="space-y-7">
    <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="eyebrow">Business visibility</p><h1 className="mt-2 text-3xl font-black tracking-tight text-[var(--teal-dark)]">Tracking</h1><p className="mt-2 text-sm leading-6 text-[var(--muted)]">Follow recorded transactions, status changes and financial movements for {workspace?.business.name ?? "your business"}.</p></div><button onClick={() => void load()} disabled={refreshing} className="secondary-button w-fit"><RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />{refreshing ? "Refreshing…" : "Refresh tracking"}</button></section>
    {error && <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
    <section className="grid gap-4 sm:grid-cols-3"><div className="surface p-5"><p className="text-sm font-semibold text-[var(--muted)]">Successful transactions</p><p className="mt-3 text-2xl font-black text-emerald-700">{successful}</p></div><div className="surface p-5"><p className="text-sm font-semibold text-[var(--muted)]">Pending tracking</p><p className="mt-3 text-2xl font-black text-amber-700">{pending}</p></div><div className="surface p-5"><p className="text-sm font-semibold text-[var(--muted)]">Failed or reversed</p><p className="mt-3 text-2xl font-black text-rose-700">{failed + transactions.filter((row) => row.transaction_status === "REVERSED").length}</p></div></section>
    <section className="grid gap-5 lg:grid-cols-2"><div className="surface flex gap-4 p-5 sm:p-6"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-emerald-700"><ShieldCheck size={21} /></span><div><h2 className="font-black text-[var(--teal-dark)]">Transaction tracking is active</h2><p className="mt-1 text-sm leading-6 text-[var(--muted)]">Records are loaded from the existing Supabase transaction and status-history tables. New records appear here after they are recorded.</p><Link href="/new-transaction" className="mt-3 inline-flex text-sm font-bold text-[var(--teal)]">Record a transaction →</Link></div></div><div className="surface flex gap-4 p-5 sm:p-6"><span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${notificationEnabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{notificationEnabled ? <Bell size={21} /> : <BellOff size={21} />}</span><div className="min-w-0"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-black text-[var(--teal-dark)]">Notification tracking</h2>{notificationAvailable && <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${notificationEnabled ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{notificationEnabled ? "Enabled" : "Needs access"}</span>}</div><p className="mt-1 text-sm leading-6 text-[var(--muted)]">{notificationEnabled ? `${notificationItems.length} notification${notificationItems.length === 1 ? "" : "s"} captured on this phone.` : "Android requires you to grant notification access before MoMo Ledger can read notification content."}</p>{notificationAvailable ? <button type="button" onClick={async () => { await window.Capacitor?.Plugins?.NotificationTracking?.openSettings(); }} className="mt-3 text-sm font-bold text-[var(--teal)]">{notificationEnabled ? "Review Android access →" : "Enable Android notification access →"}</button> : <p className="mt-3 text-xs font-semibold text-[var(--muted)]">Available in the Android app only. Browser tracking remains unavailable.</p>}</div></div></section>
    {notificationEnabled && notificationItems.length > 0 && <section className="surface overflow-hidden"><div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-5"><div><p className="eyebrow">Device inbox</p><h2 className="mt-1 text-xl font-black text-[var(--teal-dark)]">Captured notifications</h2></div><Bell size={20} className="text-[var(--teal)]" /></div><div className="divide-y divide-[#edf0f1]">{notificationItems.slice(0, 20).map((item) => <article key={`${item.id}-${item.capturedAt}`} className="px-5 py-4"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><p className="truncate text-sm font-bold text-[var(--teal-dark)]">{item.title || "Notification"}</p><p className="mt-1 text-sm leading-6 text-[var(--ink)]">{item.text}</p><p className="mt-1 text-xs text-[var(--muted)]">{item.packageName}</p></div><time className="shrink-0 text-xs text-[var(--muted)]">{new Date(item.postedAt).toLocaleString("en-GH", { dateStyle: "medium", timeStyle: "short" })}</time></div></article>)}</div><p className="border-t border-[var(--line)] px-5 py-3 text-xs leading-5 text-[var(--muted)]">These are local Android notification records. They are not automatically converted into financial transactions or posted to the ledger.</p></section>}
    <section className="surface overflow-hidden"><div className="flex flex-col justify-between gap-3 border-b border-[var(--line)] px-5 py-5 sm:flex-row sm:items-center sm:px-6"><div><p className="eyebrow">Operational records</p><h2 className="mt-1 text-xl font-black text-[var(--teal-dark)]">Transaction tracker</h2></div><div className="flex flex-col gap-2 sm:flex-row"><input value={query} onChange={(event) => setQuery(event.target.value)} className="field-input min-w-0 sm:w-56" placeholder="Search reference or phone" /><select value={status} onChange={(event) => setStatus(event.target.value)} className="field-input"><option value="ALL">All statuses</option><option value="PENDING">Pending</option><option value="SUCCESSFUL">Successful</option><option value="FAILED">Failed</option><option value="REVERSED">Reversed</option></select></div></div>{visibleTransactions.length === 0 ? <div className="p-10 text-center text-sm text-[var(--muted)]">No transactions match the current tracking filters.</div> : <div className="overflow-x-auto"><table className="data-table"><thead><tr><th>Reference</th><th>Type</th><th>Network</th><th>Customer</th><th>Amount</th><th>Status</th><th>Recorded</th></tr></thead><tbody>{visibleTransactions.map((row) => <tr key={row.id}><td className="font-bold">{row.internal_reference}</td><td>{typeLabel(row.transaction_type)}</td><td>{networkLabel(row.network)}</td><td>{maskPhone(row.customer_phone)}</td><td className="font-bold">{gh(row.principal_amount_pesewas)}</td><td><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${badge(row.transaction_status)}`}>{row.transaction_status}</span></td><td className="whitespace-nowrap">{new Date(row.transaction_at).toLocaleString("en-GH", { dateStyle: "medium", timeStyle: "short" })}</td></tr>)}</tbody></table></div>}</section>
    <section className="grid gap-5 lg:grid-cols-2"><div className="surface overflow-hidden"><div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-5"><div><p className="eyebrow">Audit trail</p><h2 className="mt-1 text-xl font-black text-[var(--teal-dark)]">Status history</h2></div><Activity size={20} className="text-[var(--teal)]" /></div>{history.length === 0 ? <div className="p-8 text-sm text-[var(--muted)]">No status changes have been recorded yet.</div> : <div className="divide-y divide-[#edf0f1]">{history.slice(0, 12).map((row) => <div key={row.id} className="px-5 py-4"><div className="flex items-center justify-between gap-3"><p className="text-sm font-bold text-[var(--teal-dark)]">{row.from_status ? `${row.from_status} → ` : "Initial → "}{row.to_status}</p><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${badge(row.to_status)}`}>{row.to_status}</span></div><p className="mt-1 text-xs text-[var(--muted)]">Transaction {row.transaction_id.slice(0, 8)}… · {row.reason ?? "Status update"} · {new Date(row.created_at).toLocaleString("en-GH", { dateStyle: "medium", timeStyle: "short" })}</p></div>)}</div>}</div><div className="surface overflow-hidden"><div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-5"><div><p className="eyebrow">Financial tracking</p><h2 className="mt-1 text-xl font-black text-[var(--teal-dark)]">Latest ledger changes</h2></div><span className="text-xs font-semibold text-[var(--muted)]">Latest {Math.min(ledger.length, 12)}</span></div>{ledger.length === 0 ? <div className="p-8 text-sm text-[var(--muted)]">No ledger movements have been posted yet.</div> : <div className="divide-y divide-[#edf0f1]">{ledger.slice(0, 12).map((row) => { const positive = Number(row.balance_delta_pesewas) >= 0; return <div key={row.id} className="flex items-center justify-between gap-3 px-5 py-4"><div className="flex min-w-0 items-center gap-3"><span className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl ${positive ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{positive ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}</span><div className="min-w-0"><p className="truncate text-sm font-bold">{row.description}</p><p className="mt-1 text-xs text-[var(--muted)]">{row.entry_type} · {new Date(row.created_at).toLocaleString("en-GH", { dateStyle: "medium", timeStyle: "short" })}</p></div></div><div className="text-right"><p className={`text-sm font-black ${positive ? "text-emerald-700" : "text-rose-700"}`}>{positive ? "+" : "−"}{gh(Math.abs(Number(row.balance_delta_pesewas)))}</p><p className="text-xs text-[var(--muted)]">{gh(row.resulting_balance_pesewas)}</p></div></div>; })}</div>}</div></section>
  </div>;
}
