"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase";

const navigation = [
  ["Dashboard", "/dashboard", "⌂"], ["New Transaction", "/new-transaction", "+"], ["Transactions", "/transactions", "≡"], ["Customers", "/customers", "◌"], ["Float Management", "/float-management", "◈"], ["Cashbook", "/cashbook", "▤"], ["Expenses", "/expenses", "−"], ["Reconciliation", "/reconciliation", "✓"], ["Reports", "/reports", "▥"], ["Attendants", "/attendants", "♙"], ["Settings", "/settings", "⚙"],
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const supabase = useMemo(() => createClient(), []);
  const [identity, setIdentity] = useState<{ name: string; email: string } | null>(null);
  useEffect(() => { if (!supabase) return; supabase.auth.getUser().then(({ data }) => { if (data.user) setIdentity({ name: data.user.user_metadata?.full_name ?? "Owner workspace", email: data.user.email ?? "" }); }); }, [supabase, pathname]);
  async function logout() { if (supabase) await supabase.auth.signOut(); window.location.href = "/auth"; }
  if (pathname === "/auth") return <>{children}</>;
  return <div className="min-h-screen lg:flex">
    <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white lg:fixed lg:inset-y-0 lg:flex lg:flex-col">
      <div className="border-b border-slate-100 px-6 py-6"><Link href="/dashboard" className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-sky-400 text-lg font-black text-slate-950">M</span><span><strong className="block text-lg tracking-tight text-slate-900">MoMo Ledger</strong><small className="text-xs text-slate-500">Business control, simplified</small></span></Link></div>
      <nav aria-label="Main navigation" className="flex-1 space-y-1 overflow-y-auto px-3 py-5">{navigation.map(([label, href, icon]) => { const active = pathname === href || (href === "/dashboard" && pathname === "/"); return <Link key={href} href={href} className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold ${active ? "bg-sky-50 text-slate-950" : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"}`}><span className={`grid h-7 w-7 place-items-center rounded-lg text-base ${active ? "bg-sky-400 text-slate-950" : "bg-slate-100 text-slate-500"}`}>{icon}</span>{label}</Link>; })}</nav>
      <div className="border-t border-slate-100 p-4"><Link href="/setup" className="block rounded-xl bg-slate-50 p-3 hover:bg-sky-50"><p className="text-xs font-bold text-slate-700">Workspace setup</p><p className="mt-1 text-xs leading-5 text-slate-500">Edit your business, booth and opening position.</p></Link></div>
    </aside>
    <div className="min-w-0 flex-1 lg:pl-64"><header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:px-6 lg:px-8"><div className="mx-auto flex max-w-7xl items-center justify-between gap-4"><Link href="/dashboard" className="flex items-center gap-2 lg:hidden"><span className="grid h-9 w-9 place-items-center rounded-lg bg-sky-400 font-black text-slate-950">M</span><span className="font-black text-slate-900">MoMo Ledger</span></Link><div className="hidden min-w-0 text-sm text-slate-500 lg:block">Your Transactions. Your Float. Your Business. Under Control.</div><div className="ml-auto flex items-center gap-2"><Link href="/new-transaction" className="primary-button"><span className="text-lg leading-none">+</span><span className="hidden sm:inline">New Transaction</span><span className="sm:hidden">New</span></Link>{identity ? <div className="group relative"><button aria-label="Open account menu" className="grid h-11 w-11 place-items-center rounded-xl bg-slate-100 text-sm font-black text-slate-700">{identity.name.charAt(0).toUpperCase()}</button><div className="invisible absolute right-0 top-12 w-56 rounded-xl border border-slate-200 bg-white p-2 opacity-0 shadow-lg transition group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"><p className="truncate px-3 py-2 text-sm font-bold text-slate-900">{identity.name}</p><p className="truncate px-3 pb-2 text-xs text-slate-500">{identity.email}</p><Link href="/settings" className="block rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">Business settings</Link><button onClick={logout} className="w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-red-600 hover:bg-red-50">Log out</button></div></div> : <Link href="/auth" className="secondary-button">Log in</Link>}</div></div></header><div className="border-b border-slate-200 bg-white px-3 py-2 lg:hidden"><nav aria-label="Mobile navigation" className="flex gap-1 overflow-x-auto">{navigation.slice(0, 6).map(([label, href]) => <Link key={href} href={href} className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-bold ${pathname === href ? "bg-sky-50 text-slate-950" : "text-slate-500"}`}>{label}</Link>)}</nav></div><main className="mx-auto max-w-7xl px-4 py-7 sm:px-6 lg:px-8">{children}</main></div>
  </div>;
}
