"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase";

const navItems = ["Overview", "My films", "Submit a film", "Rights documents", "Earnings", "Profile", "Support"];

export default function CreatorPage() {
  const supabase = useMemo(() => createClient(), []);
  const [state, setState] = useState<"loading" | "signed-out" | "viewer" | "creator" | "admin">("loading");
  const [name, setName] = useState("Creator");

  useEffect(() => {
    async function load() {
      if (!supabase) { setState("signed-out"); return; }
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setState("signed-out"); return; }
      const { data } = await supabase.from("profiles").select("display_name, role").eq("id", user.id).maybeSingle();
      setName(data?.display_name || user.user_metadata?.full_name || "Creator");
      if (data?.role === "creator") setState("creator");
      else if (data?.role === "administrator" || data?.role === "super_admin") setState("admin");
      else setState("viewer");
    }
    load();
  }, [supabase]);

  if (state === "loading") return <div className="mx-auto max-w-6xl px-5 py-24"><p className="font-bold text-coral">Checking creator access…</p></div>;
  if (state === "signed-out") return <section className="mx-auto max-w-3xl px-5 py-24 text-center"><p className="text-sm font-black uppercase tracking-[.2em] text-coral">Creator workspace</p><h1 className="mt-4 text-5xl font-black">Sign in to continue.</h1><p className="mx-auto mt-5 max-w-xl leading-7 text-ink/65">Creator tools are available to authenticated members with creator access.</p><a href="/auth" className="mt-8 inline-flex rounded-full bg-coral px-6 py-3 font-bold text-white">Go to sign in</a></section>;
  if (state === "viewer") return <section className="mx-auto max-w-3xl px-5 py-24 text-center"><p className="text-sm font-black uppercase tracking-[.2em] text-coral">Creator workspace</p><h1 className="mt-4 text-5xl font-black">Your creator profile is next.</h1><p className="mx-auto mt-5 max-w-xl leading-7 text-ink/65">Your account is currently a viewer account. Creator access is granted after the creator registration and verification workflow, so roles cannot be self-assigned from the browser.</p><a href="/account" className="mt-8 inline-flex rounded-full bg-ink px-6 py-3 font-bold text-white">Return to account</a></section>;

  return (
    <div className="min-h-[calc(100vh-145px)] bg-[#102a43] text-white">
      <div className="mx-auto grid max-w-7xl md:grid-cols-[240px_1fr]">
        <aside className="border-b border-white/10 p-5 md:min-h-[calc(100vh-145px)] md:border-b-0 md:border-r md:p-7"><a href="/" className="text-lg font-black tracking-tight">GHANA<span className="text-gold">FIRST</span></a><p className="mt-12 text-xs font-black uppercase tracking-[.2em] text-white/45">Creator studio</p><nav className="mt-4 space-y-1">{navItems.map((item, index) => <button key={item} onClick={() => { if (index > 0) alert("This creator tool will be enabled in a future stage."); }} className={`block w-full rounded-xl px-4 py-3 text-left text-sm font-bold ${index === 0 ? "bg-white/10 text-gold" : "text-white/65 hover:bg-white/5 hover:text-white"}`}>{item}</button>)}</nav><a href="/account" className="mt-12 block text-sm font-bold text-white/50 hover:text-gold">← Account</a></aside>
        <main className="p-5 md:p-10"><div className="flex flex-col justify-between gap-5 border-b border-white/10 pb-8 md:flex-row md:items-end"><div><p className="text-sm font-black uppercase tracking-[.2em] text-gold">Overview</p><h1 className="mt-3 text-4xl font-black md:text-6xl">Good to see you, {name.split(" ")[0]}.</h1><p className="mt-3 text-white/60">Your creative workspace, in one calm place.</p></div><span className="inline-flex w-fit rounded-full bg-emerald-400/15 px-4 py-2 text-sm font-bold text-emerald-300">Profile verified</span></div>
          <div className="mt-8 grid gap-4 md:grid-cols-3"><article className="rounded-3xl bg-white/10 p-6"><p className="text-sm text-white/50">Films in review</p><p className="mt-3 text-4xl font-black">0</p><p className="mt-2 text-sm text-white/50">No submissions yet</p></article><article className="rounded-3xl bg-white/10 p-6"><p className="text-sm text-white/50">Published films</p><p className="mt-3 text-4xl font-black">0</p><p className="mt-2 text-sm text-white/50">Your catalogue starts here</p></article><article className="rounded-3xl bg-gold p-6 text-ink"><p className="text-sm font-bold text-ink/60">Earnings</p><p className="mt-3 text-4xl font-black">GH₵0</p><p className="mt-2 text-sm text-ink/60">Finance opens after publishing</p></article></div>
          <section className="mt-8 grid gap-5 lg:grid-cols-[1.2fr_.8fr]"><div className="rounded-3xl bg-white p-7 text-ink"><div className="flex items-start justify-between gap-4"><div><p className="text-sm font-black uppercase tracking-[.18em] text-coral">Next step</p><h2 className="mt-3 text-3xl font-black">Submit your first film.</h2><p className="mt-3 max-w-lg leading-7 text-ink/60">The submission flow will collect your film metadata, poster, trailer, rights documents, and review details before anything is published.</p></div><span className="rounded-full bg-sand px-3 py-1 text-xs font-black text-ink/50">Coming next</span></div><button onClick={() => alert("Film submission will be enabled in the next creator stage.")} className="mt-7 rounded-full bg-coral px-5 py-3 font-bold text-white hover:bg-ink">Start a submission</button></div><div className="rounded-3xl border border-white/10 bg-white/5 p-7"><p className="text-sm font-black uppercase tracking-[.18em] text-gold">Workspace health</p><div className="mt-5 space-y-4 text-sm"><p className="flex justify-between border-b border-white/10 pb-4"><span className="text-white/55">Profile</span><span className="font-bold text-emerald-300">Ready</span></p><p className="flex justify-between border-b border-white/10 pb-4"><span className="text-white/55">Rights documents</span><span className="font-bold text-white/50">Not started</span></p><p className="flex justify-between"><span className="text-white/55">Payouts</span><span className="font-bold text-white/50">Disabled</span></p></div></div></section>
        </main>
      </div>
    </div>
  );
}
