"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  BarChart3, Bell, BookOpen, ChevronRight, CircleDollarSign, ClipboardList,
  ContactRound, FileText, Home, Landmark, LogOut, Menu, MoreHorizontal,
  Plus, Receipt, ReceiptText, Settings, ShieldCheck, Store, Users, WalletCards, X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { createClient } from "@/lib/supabase";

const navigation: { label: string; href: string; icon: LucideIcon }[] = [
  { label: "Home", href: "/dashboard", icon: Home },
  { label: "Transactions", href: "/transactions", icon: Receipt },
  { label: "Customers", href: "/customers", icon: Users },
  { label: "Reconciliation", href: "/reconciliation", icon: ShieldCheck },
  { label: "Cashbook", href: "/cashbook", icon: BookOpen },
  { label: "Expenses", href: "/expenses", icon: CircleDollarSign },
  { label: "Sales & receipts", href: "/sales", icon: ReceiptText },
  { label: "Float management", href: "/float-management", icon: WalletCards },
  { label: "Reports", href: "/reports", icon: BarChart3 },
  { label: "Attendants", href: "/attendants", icon: ContactRound },
];

const moreNavigation = [
  { label: "Business setup", href: "/setup", icon: Store },
  { label: "Settings", href: "/settings", icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const supabase = useMemo(() => createClient(), []);
  const [identity, setIdentity] = useState<{ name: string; email: string } | null>(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  useEffect(() => { if (!supabase) return; supabase.auth.getUser().then(({ data }) => { if (data.user) setIdentity({ name: data.user.user_metadata?.full_name ?? "Owner workspace", email: data.user.email ?? "" }); }); }, [supabase, pathname]);
  async function logout() { if (supabase) await supabase.auth.signOut(); window.location.href = "/auth"; }
  if (pathname === "/auth") return <>{children}</>;
  const active = (href: string) => pathname === href || (href !== "/dashboard" && pathname.startsWith(`${href}/`)) || (href === "/dashboard" && pathname === "/");
  const initials = identity?.name?.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase() ?? "ML";
  const mobileNavigation = [
    { label: "Home", href: "/dashboard", icon: Home, record: false },
    { label: "Transactions", href: "/transactions", icon: Receipt, record: false },
    { label: "Record", href: "/new-transaction", icon: Plus, record: true },
    { label: "Cashbook", href: "/cashbook", icon: BookOpen, record: false },
    { label: "More", href: "/settings", icon: MoreHorizontal, record: false },
  ];

  return <div className="min-h-screen lg:flex">
    <aside className="hidden w-64 shrink-0 bg-[var(--teal-dark)] text-white lg:fixed lg:inset-y-0 lg:flex lg:flex-col">
      <div className="border-b border-white/10 px-6 py-6"><Link href="/dashboard" className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--yellow)] text-lg font-black text-[var(--teal-dark)]">M</span><span><strong className="block text-lg tracking-tight">MoMo Ledger</strong><small className="text-xs text-white/60">Business control, simplified</small></span></Link></div>
      <nav aria-label="Main navigation" className="flex-1 space-y-1 overflow-y-auto px-3 py-5">{navigation.map(({ label, href, icon: Icon }) => <Link key={href} href={href} className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold ${active(href) ? "bg-white text-[var(--teal-dark)]" : "text-white/70 hover:bg-white/10 hover:text-white"}`}><Icon size={18} strokeWidth={1.8} /><span>{label}</span>{active(href) && <span className="ml-auto h-2 w-2 rounded-full bg-[var(--yellow)]" />}</Link>)}</nav>
      <div className="border-t border-white/10 p-4"><Link href="/setup" className="block rounded-xl bg-white/10 p-3 hover:bg-white/15"><p className="text-xs font-bold">Workspace setup</p><p className="mt-1 text-xs leading-5 text-white/60">Edit your business, booth and opening position.</p></Link></div>
    </aside>
    <div className="min-w-0 flex-1 lg:pl-64">
      <header className="sticky top-0 z-20 bg-[var(--teal)] px-4 py-3 text-white shadow-sm sm:px-6 lg:px-8"><div className="mx-auto flex max-w-7xl items-center justify-between gap-4"><button aria-label="Open navigation" onClick={() => setMobileMenu(true)} className="grid h-10 w-10 place-items-center rounded-xl bg-white/10 lg:hidden"><Menu size={20} /></button><Link href="/dashboard" className="flex items-center gap-2 lg:hidden"><span className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--yellow)] font-black text-[var(--teal-dark)]">M</span><span className="font-black">MoMo Ledger</span></Link><div className="hidden min-w-0 text-sm text-white/70 lg:block">Your transactions. Your float. Your business. Under control.</div><div className="ml-auto flex items-center gap-2"><Link href="/new-transaction" className="primary-button"><span className="hidden sm:inline">New transaction</span><span className="sm:hidden">New</span></Link><button aria-label="Notifications" className="grid h-10 w-10 place-items-center rounded-xl bg-white/10 hover:bg-white/15"><Bell size={19} /></button>{identity ? <div className="group relative"><button aria-label="Open account menu" className="grid h-10 w-10 place-items-center rounded-xl bg-white text-sm font-black text-[var(--teal)]">{initials}</button><div className="invisible absolute right-0 top-12 w-56 rounded-xl border border-[var(--line)] bg-white p-2 text-[var(--ink)] opacity-0 shadow-lg transition group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"><p className="truncate px-3 py-2 text-sm font-bold">{identity.name}</p><p className="truncate px-3 pb-2 text-xs text-[var(--muted)]">{identity.email}</p><Link href="/settings" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-[var(--muted)] hover:bg-[var(--canvas)]"><Settings size={15} /> Business settings</Link><button onClick={logout} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-red-700 hover:bg-red-50"><LogOut size={15} /> Log out</button></div></div> : <Link href="/auth" className="secondary-button">Log in</Link>}</div></div></header>
      <main className="mx-auto max-w-7xl px-4 py-6 pb-24 sm:px-6 lg:px-8 lg:py-8 lg:pb-8">{children}</main>
      <nav aria-label="Mobile navigation" className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-[var(--line)] bg-white/95 px-2 py-2 shadow-[0_-4px_18px_rgba(0,64,96,.08)] backdrop-blur lg:hidden">{mobileNavigation.map(({ label, href, icon: Icon, record }) => <Link key={label} href={href} className={`relative flex flex-col items-center gap-1 rounded-xl py-1.5 text-[10px] font-bold ${record ? "-mt-7 text-[var(--teal)]" : active(href) ? "text-[var(--teal)]" : "text-[var(--muted)]"}`}><span className={record ? "grid h-14 w-14 place-items-center rounded-full border-4 border-white bg-[var(--yellow)] text-[var(--teal-dark)] shadow-[0_4px_12px_rgba(0,64,96,.18)]" : ""}><Icon size={record ? 28 : 20} strokeWidth={record ? 2 : active(href) ? 2.4 : 1.8} /></span>{label}{!record && active(href) && <span className="absolute bottom-0 h-1 w-6 rounded-full bg-[var(--yellow)]" />}</Link>)}</nav>
      {mobileMenu && <div className="fixed inset-0 z-30 bg-[var(--teal-dark)] p-5 text-white lg:hidden"><div className="flex items-center justify-between"><span className="text-lg font-black">Menu</span><button aria-label="Close navigation" onClick={() => setMobileMenu(false)} className="grid h-10 w-10 place-items-center rounded-xl bg-white/10"><X size={20} /></button></div><nav className="mt-6 space-y-2">{[...navigation, ...moreNavigation].map(({ label, href, icon: Icon }) => <Link key={href} onClick={() => setMobileMenu(false)} href={href} className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold ${active(href) ? "bg-white text-[var(--teal-dark)]" : "text-white/75 hover:bg-white/10"}`}><Icon size={19} />{label}<ChevronRight className="ml-auto" size={16} /></Link>)}</nav></div>}
    </div>
  </div>;
}
