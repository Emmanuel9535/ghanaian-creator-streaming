"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  Activity, BarChart3, Bell, BookOpen, ChevronRight, CircleDollarSign, ContactRound,
  Home, LogOut, Menu, MoreHorizontal, Plus, Receipt, ReceiptText, Settings,
  ShieldCheck, Store, Users, WalletCards, X,
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
  { label: "Tracking", href: "/tracking", icon: Activity },
  { label: "Reports", href: "/reports", icon: BarChart3 },
  { label: "Attendants", href: "/attendants", icon: ContactRound },
];

const moreNavigation: { label: string; href: string; icon: LucideIcon }[] = [
  { label: "Business setup", href: "/setup", icon: Store },
  { label: "Settings", href: "/settings", icon: Settings },
];

const mobilePrimaryNavigation = [
  { label: "Home", href: "/dashboard", icon: Home },
  { label: "Transactions", href: "/transactions", icon: Receipt },
  { label: "Record", href: "/new-transaction", icon: Plus },
  { label: "Cashbook", href: "/cashbook", icon: BookOpen },
];
const mobilePrimaryHrefs = new Set(mobilePrimaryNavigation.map((item) => item.href));

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const supabase = useMemo(() => createClient(), []);
  const [identity, setIdentity] = useState<{ name: string; email: string } | null>(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [mobileMore, setMobileMore] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setIdentity({
          name: data.user.user_metadata?.full_name ?? "Owner workspace",
          email: data.user.email ?? "",
        });
      }
    });
  }, [supabase, pathname]);

  async function logout() {
    if (supabase) await supabase.auth.signOut();
    window.location.href = "/auth";
  }

  if (pathname === "/auth") return <>{children}</>;

  const active = (href: string) => pathname === href
    || (href !== "/dashboard" && pathname.startsWith(`${href}/`))
    || (href === "/dashboard" && pathname === "/");
  const initials = identity?.name?.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase() ?? "ML";
  const mobileMoreItems = [
    ...navigation.filter(({ href }) => !mobilePrimaryHrefs.has(href)),
    ...moreNavigation,
  ];
  const moreIsActive = mobileMoreItems.some(({ href }) => active(href));

  return (
    <div className="min-h-screen lg:flex">
      <aside className="hidden w-64 shrink-0 bg-[var(--teal-dark)] text-white lg:fixed lg:inset-y-0 lg:flex lg:flex-col">
        <div className="border-b border-white/10 px-6 py-6">
          <Link href="/dashboard" className="flex items-center gap-3">
            <Image src="/momo-ledger-logo.png" alt="MoMo Ledger logo" width={40} height={40} priority className="h-10 w-10 rounded-xl object-cover" />
            <span>
              <strong className="block text-lg font-semibold tracking-tight">MoMo Ledger</strong>
              <small className="text-xs text-white/65">A calmer way to run your MoMo business.</small>
            </span>
          </Link>
        </div>
        <nav aria-label="Main navigation" className="flex-1 space-y-1 overflow-y-auto px-3 py-5">
          {navigation.map(({ label, href, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold ${active(href) ? "bg-white text-[var(--teal-dark)]" : "text-white/75 hover:bg-white/10 hover:text-white"}`}
            >
              <Icon size={18} strokeWidth={1.8} />
              <span>{label}</span>
              {active(href) && <span className="ml-auto h-2 w-2 rounded-full bg-[var(--yellow)]" />}
            </Link>
          ))}
        </nav>
        <div className="border-t border-white/10 p-4">
          <Link href="/setup" className="block rounded-xl bg-white/10 p-3 hover:bg-white/15">
            <p className="text-xs font-semibold">Workspace setup</p>
            <p className="mt-1 text-xs leading-5 text-white/65">Edit your business, booth and opening position.</p>
          </Link>
        </div>
      </aside>

      <div className="min-w-0 flex-1 lg:pl-64">
        <header className="sticky top-0 z-20 bg-[var(--teal)] px-3 py-3 text-white shadow-sm sm:px-6 lg:px-8">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
            <button
              aria-label="Open navigation"
              onClick={() => setMobileMenu(true)}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/10 hover:bg-white/15 lg:hidden"
            >
              <Menu size={20} strokeWidth={1.8} />
            </button>
            <Link href="/dashboard" className="flex min-w-0 items-center gap-2 lg:hidden">
              <Image src="/momo-ledger-logo.png" alt="MoMo Ledger logo" width={36} height={36} priority className="h-9 w-9 shrink-0 rounded-lg object-cover" />
              <span className="truncate text-sm font-semibold">MoMo Ledger</span>
            </Link>
            <div className="hidden min-w-0 text-sm text-white/75 lg:block">Your transactions. Your float. Your business. Under control.</div>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <Link href="/new-transaction" className="primary-button hidden sm:inline-flex">
                New transaction
              </Link>
              <Link href="/new-transaction" aria-label="New transaction" className="primary-button min-h-10 px-3 sm:hidden">
                New
              </Link>
              <button aria-label="Notifications" className="hidden h-10 w-10 place-items-center rounded-xl bg-white/10 hover:bg-white/15 sm:grid">
                <Bell size={19} strokeWidth={1.8} />
              </button>
              {identity ? (
                <div className="group relative">
                  <button aria-label="Open account menu" className="grid h-10 w-10 place-items-center rounded-xl bg-white text-sm font-semibold text-[var(--teal)]">
                    {initials}
                  </button>
                  <div className="invisible absolute right-0 top-12 w-56 rounded-xl border border-[var(--line)] bg-white p-2 text-[var(--ink)] opacity-0 shadow-lg transition group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
                    <p className="truncate px-3 py-2 text-sm font-semibold">{identity.name}</p>
                    <p className="truncate px-3 pb-2 text-xs text-[var(--muted)]">{identity.email}</p>
                    <Link href="/settings" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-[var(--muted)] hover:bg-[var(--canvas)]">
                      <Settings size={15} strokeWidth={1.8} /> Business settings
                    </Link>
                    <button onClick={logout} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-red-700 hover:bg-red-50">
                      <LogOut size={15} strokeWidth={1.8} /> Log out
                    </button>
                  </div>
                </div>
              ) : (
                <Link href="/auth" className="secondary-button">Log in</Link>
              )}
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 py-6 pb-28 sm:px-6 lg:px-8 lg:py-8 lg:pb-8">
          {children}
        </main>

        <nav aria-label="Mobile navigation" className="mobile-bottom-nav fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-[var(--line)] bg-white/95 px-2 pb-2 pt-2 shadow-[0_-4px_18px_rgba(0,64,96,.08)] backdrop-blur lg:hidden">
          {mobilePrimaryNavigation.map(({ label, href, icon: Icon }) => {
            const isCurrent = active(href);
            const isRecord = href === "/new-transaction";
            return (
              <Link
                key={href}
                href={href}
                aria-current={isCurrent ? "page" : undefined}
                className={`relative flex min-h-12 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${isCurrent ? "text-[var(--teal)]" : "text-[var(--ink)]"}`}
              >
                <span className={isRecord
                  ? "-mt-5 grid h-11 w-11 place-items-center rounded-full border-[3px] border-white bg-[var(--yellow)] text-[var(--teal-dark)] shadow-md"
                  : "grid h-6 w-6 place-items-center"}>
                  <Icon size={isRecord ? 22 : 20} strokeWidth={isCurrent ? 2 : 1.8} />
                </span>
                <span>{label}</span>
                {isCurrent && !isRecord && <span className="absolute bottom-0 h-1 w-6 rounded-full bg-[var(--yellow)]" />}
              </Link>
            );
          })}
          <button
            type="button"
            aria-expanded={mobileMore}
            onClick={() => setMobileMore((open) => !open)}
            className={`flex min-h-12 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${mobileMore || moreIsActive ? "text-[var(--teal)]" : "text-[var(--ink)]"}`}
          >
            <MoreHorizontal size={20} strokeWidth={1.8} />
            More
          </button>
        </nav>

        {mobileMore && (
          <div className="fixed inset-x-3 bottom-[5.25rem] z-30 max-h-[70vh] overflow-y-auto rounded-2xl border border-[var(--line)] bg-white p-3 shadow-xl lg:hidden">
            <div className="mb-2 flex items-center justify-between px-2">
              <strong className="text-sm font-semibold text-[var(--teal-dark)]">More features</strong>
              <button type="button" aria-label="Close More menu" onClick={() => setMobileMore(false)} className="rounded-lg px-2 py-1 text-sm text-[var(--muted)]">Close</button>
            </div>
            {mobileMoreItems.map(({ label, href, icon: Icon }) => (
              <Link
                key={href}
                onClick={() => setMobileMore(false)}
                href={href}
                className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold ${active(href) ? "bg-[#EEF6F8] text-[var(--teal-dark)]" : "text-[var(--ink)] hover:bg-[var(--canvas)]"}`}
              >
                <Icon size={18} strokeWidth={1.8} />
                <span>{label}</span>
                <ChevronRight className="ml-auto" size={15} strokeWidth={1.8} />
              </Link>
            ))}
          </div>
        )}

        {mobileMenu && (
          <div className="fixed inset-0 z-30 overflow-y-auto bg-[var(--teal-dark)] p-5 text-white lg:hidden">
            <div className="flex items-center justify-between">
              <span className="text-lg font-semibold">Menu</span>
              <button aria-label="Close navigation" onClick={() => setMobileMenu(false)} className="grid h-10 w-10 place-items-center rounded-xl bg-white/10">
                <X size={20} strokeWidth={1.8} />
              </button>
            </div>
            <nav aria-label="Expanded navigation" className="mt-6 space-y-2">
              {[...navigation, ...moreNavigation].map(({ label, href, icon: Icon }) => (
                <Link
                  key={href}
                  onClick={() => setMobileMenu(false)}
                  href={href}
                  className={`flex min-h-11 items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold ${active(href) ? "bg-white text-[var(--teal-dark)]" : "text-white/75 hover:bg-white/10"}`}
                >
                  <Icon size={19} strokeWidth={1.8} />
                  {label}
                  <ChevronRight className="ml-auto" size={16} strokeWidth={1.8} />
                </Link>
              ))}
            </nav>
          </div>
        )}
      </div>
    </div>
  );
}
