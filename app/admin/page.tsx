"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase";

export default function AdminPage() {
  const supabase = useMemo(() => createClient(), []);
  const [state, setState] = useState<"loading" | "signed-out" | "denied" | "allowed">("loading");

  useEffect(() => {
    async function checkAccess() {
      if (!supabase) { setState("signed-out"); return; }
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setState("signed-out"); return; }
      const { data } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
      setState(data?.role === "administrator" || data?.role === "super_admin" ? "allowed" : "denied");
    }
    checkAccess();
  }, [supabase]);

  if (state === "loading") return <div className="mx-auto max-w-6xl px-5 py-24"><p className="font-bold text-coral">Checking administrator access…</p></div>;
  if (state === "signed-out") return <section className="mx-auto max-w-3xl px-5 py-24 text-center"><p className="text-sm font-black uppercase tracking-[.2em] text-coral">Administration</p><h1 className="mt-4 text-5xl font-black">Sign in required.</h1><a href="/auth" className="mt-8 inline-flex rounded-full bg-coral px-6 py-3 font-bold text-white">Go to sign in</a></section>;
  if (state === "denied") return <section className="mx-auto max-w-3xl px-5 py-24 text-center"><p className="text-sm font-black uppercase tracking-[.2em] text-coral">403 · Restricted</p><h1 className="mt-4 text-5xl font-black">This area is for administrators.</h1><p className="mx-auto mt-5 max-w-xl leading-7 text-ink/65">Your current role does not grant access. Roles are enforced by Supabase row-level security and cannot be self-assigned in the browser.</p><a href="/account" className="mt-8 inline-flex rounded-full bg-ink px-6 py-3 font-bold text-white">Return to account</a></section>;
  return <section className="mx-auto max-w-6xl px-5 py-16"><p className="text-sm font-black uppercase tracking-[.2em] text-coral">Administration</p><h1 className="mt-4 text-6xl font-black">Operations overview.</h1><div className="mt-10 grid gap-4 md:grid-cols-4">{["Users", "Creators", "Film approvals", "System health"].map((item) => <article key={item} className="rounded-3xl bg-white p-6 shadow-lg shadow-ink/5"><p className="text-sm text-ink/50">{item}</p><p className="mt-3 text-3xl font-black">0</p><p className="mt-2 text-sm text-ink/50">Ready for the operations stage</p></article>)}</div></section>;
}
