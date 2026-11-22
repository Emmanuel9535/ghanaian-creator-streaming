"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase";
import { gh, maskPhone, networkLabel, typeLabel } from "@/lib/transactions";

type Business = { id: string; name: string; owner_name: string; setup_status: string };
type Booth = { id: string; name: string; location: string };
type Tx = { id: string; internal_reference: string; network: string; transaction_type: string; principal_amount_pesewas: number; transaction_status: string; customer_phone: string; transaction_at: string };
type Account = { code: string; category: string; network: string | null; balance_pesewas: number };
type Dashboard = { accounts: Account[]; activity: { successful_deposit_volume_pesewas: number; successful_withdrawal_volume_pesewas: number; pending_transactions: number; commission_earned_pesewas: number; commission_received_pesewas: number; requires_review: number } };

export default function DashboardPage() {
  const supabase = useMemo(() => createClient(), []);
  const [business, setBusiness] = useState<Business | null>(null);
  const [booth, setBooth] = useState<Booth | null>(null);
  const [recent, setRecent] = useState<Tx[]>([]);
  const [summary, setSummary] = useState<Dashboard | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      if (!supabase) return setLoading(false);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return setLoading(false);
      const { data: membership, error: membershipError } = await supabase.from("business_members").select("business_id,booth_id,role").eq("user_id", user.id).eq("status", "active").order("created_at", { ascending: true }).limit(1).maybeSingle();
      if (membershipError) setError(membershipError.message);
      if (!membership) return setLoading(false);
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const [{ data: b }, { data: bt }, { data: financial, error: financialError }, { data: tx }, { data: today }] = await Promise.all([
        supabase.from("businesses").select("id,name,owner_name,setup_status").eq("id", membership.business_id).maybeSingle(),
        supabase.from("booths").select("id,name,location").eq("id", membership.booth_id ?? "").maybeSingle(),
        supabase.rpc("financial_dashboard", { target_business_id: membership.business_id, target_booth_id: membership.role === "OWNER" ? null : membership.booth_id }),
        supabase.from("transactions").select("id,internal_reference,network,transaction_type,principal_amount_pesewas,transaction_status,customer_phone,transaction_at").eq("business_id", membership.business_id).order("transaction_at", { ascending: false }).limit(6),
        supabase.from("transactions").select("transaction_type,transaction_status").eq("business_id", membership.business_id).gte("transaction_at", start.toISOString()).limit(1000),
      ]);
      if (financialError) setError(financialError.message);
      setBusiness(b); setBooth(bt); setSummary((financial ?? null) as Dashboard | null); setRecent((tx ?? []) as Tx[]);
      const activityCounts: Record<string, number> = {};
      (today ?? []).forEach((item) => { activityCounts[item.transaction_type] = (activityCounts[item.transaction_type] ?? 0) + 1; activityCounts[item.transaction_status] = (activityCounts[item.transaction_status] ?? 0) + 1; });
      setCounts(activityCounts); setLoading(false);
    }
    load();
  }, [supabase]);

  if (loading) return <p className="py-10 text-sm text-slate-500">Loading your business workspace…</p>;
  const activity = summary?.activity;
  const accounts = summary?.accounts ?? [];
  const cash = accounts.find((account) => account.code === "CASH_ON_HAND")?.balance_pesewas ?? null;
  const balanceFor = (network: string) => accounts.find((account) => account.network === network)?.balance_pesewas ?? null;
  const totalFloat = accounts.filter((account) => account.category === "ELECTRONIC_FLOAT").reduce((total, account) => total + Number(account.balance_pesewas ?? 0), 0);
  const ready = business?.setup_status === "complete" && Boolean(booth) && cash !== null;
  const cards = [["Deposits today", counts.DEPOSIT ?? 0], ["Withdrawals today", counts.WITHDRAWAL ?? 0], ["Airtime today", counts.AIRTIME ?? 0], ["Bill payments today", counts.BILL_PAYMENT ?? 0], ["Pending", activity?.pending_transactions ?? 0], ["Review required", activity?.requires_review ?? 0]];
  return <div className="space-y-7">
    <section className="flex flex-col justify-between gap-5 md:flex-row md:items-end"><div><p className="eyebrow">{business ? business.name : "Owner overview"}</p><h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Welcome, {business?.owner_name?.split(" ")[0] ?? "vendor"}.</h1><p className="mt-2 text-sm text-slate-500">{booth ? `${booth.name} · ${booth.location}` : "Set up your business workspace to begin."}</p></div><Link href={business ? "/new-transaction" : "/setup"} className="primary-button w-fit">{business ? "+ Record a transaction" : "Complete setup"}</Link></section>
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">Financial summary unavailable: {error}</div>}
    {!ready && <div className="rounded-2xl border border-sky-200 bg-sky-50 p-5"><p className="text-sm font-black text-slate-950">Finish workspace setup before recording</p><p className="mt-1 text-sm text-slate-600">Opening balances stay separate from operational transaction volume.</p></div>}
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{cards.map(([title, value]) => <article key={title} className="surface p-5"><p className="text-sm font-bold text-slate-600">{title}</p><p className="mt-4 text-3xl font-black text-slate-900">{value}</p><p className="mt-2 text-xs text-slate-500">Operational count · not revenue</p></article>)}</section>
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><article className="surface p-5"><p className="eyebrow">Physical cash</p><p className="mt-3 text-2xl font-black text-slate-950">{cash === null ? "Unavailable" : gh(cash)}</p><p className="mt-1 text-xs text-slate-500">Expected cash on hand</p></article>{[["MTN", "MTN float"], ["TELECEL", "Telecel float"], ["AT", "AT Money float"]].map(([network, label]) => <article key={network} className="surface p-5"><p className="eyebrow">{label}</p><p className="mt-3 text-2xl font-black text-slate-950">{balanceFor(network) === null ? "Unavailable" : gh(balanceFor(network))}</p><p className="mt-1 text-xs text-slate-500">Electronic float · separate from cash</p></article>)}</section>
    <section className="grid gap-4 sm:grid-cols-3"><article className="surface p-5"><p className="text-sm font-bold text-slate-600">Total electronic float</p><p className="mt-3 text-2xl font-black text-slate-950">{gh(totalFloat)}</p><p className="mt-1 text-xs text-slate-500">Combined network float only</p></article><article className="surface p-5"><p className="text-sm font-bold text-slate-600">Commission earned</p><p className="mt-3 text-2xl font-black text-slate-950">{gh(activity?.commission_earned_pesewas ?? 0)}</p><p className="mt-1 text-xs text-slate-500">Not necessarily received</p></article><article className="surface p-5"><p className="text-sm font-bold text-slate-600">Commission received</p><p className="mt-3 text-2xl font-black text-slate-950">{gh(activity?.commission_received_pesewas ?? 0)}</p><p className="mt-1 text-xs text-slate-500">Confirmed received only</p></article></section>
    <section className="surface overflow-hidden"><div className="flex items-center justify-between border-b border-slate-200 px-5 py-5"><div><p className="eyebrow">Activity</p><h2 className="mt-2 text-xl font-black text-slate-950">Recent transactions</h2></div><Link href="/transactions" className="text-sm font-bold text-sky-600">View all</Link></div>{recent.length === 0 ? <div className="p-12 text-center"><h3 className="font-bold text-slate-900">No transactions recorded</h3><p className="mt-2 text-sm text-slate-500">Record a deposit, withdrawal, airtime or bill payment to see it here.</p></div> : <div className="divide-y divide-slate-100">{recent.map((row) => <Link key={row.id} href="/transactions" className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-sky-50"><div><p className="font-bold text-slate-900">{row.internal_reference} · {typeLabel(row.transaction_type)}</p><p className="mt-1 text-xs text-slate-500">{networkLabel(row.network)} · {maskPhone(row.customer_phone)} · {new Date(row.transaction_at).toLocaleString("en-GH", { dateStyle: "medium", timeStyle: "short" })}</p></div><div className="text-right"><p className="font-bold text-slate-900">{gh(row.principal_amount_pesewas)}</p><p className="text-xs font-bold text-slate-500">{row.transaction_status}</p></div></Link>)}</div>}</section>
    <p className="text-xs text-slate-500">Successful deposit volume: {gh(activity?.successful_deposit_volume_pesewas ?? 0)} · Successful withdrawal volume: {gh(activity?.successful_withdrawal_volume_pesewas ?? 0)}</p>
  </div>;
}
