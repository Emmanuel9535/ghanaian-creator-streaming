"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase";

export default function AccountPage() {
  const supabase = useMemo(() => createClient(), []);
  const [email, setEmail] = useState<string | null>(null);
  const [role, setRole] = useState("viewer");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [updatingPassword, setUpdatingPassword] = useState(false);

  useEffect(() => {
    async function load() {
      if (!supabase) { setLoading(false); return; }
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { window.location.href = "/auth"; return; }
      setEmail(user.email ?? null);
      const { data } = await supabase.from("profiles").select("display_name, role").eq("id", user.id).maybeSingle();
      setDisplayName(data?.display_name ?? user.user_metadata?.full_name ?? "");
      setRole(data?.role ?? "viewer");
      setLoading(false);
    }
    load();
  }, [supabase]);

  async function logout() {
    if (!supabase) return;
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  async function updatePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || password.length < 8) return;
    setUpdatingPassword(true);
    setNotice(null);
    const { error } = await supabase.auth.updateUser({ password });
    setUpdatingPassword(false);
    if (error) { setNotice(error.message); return; }
    setPassword("");
    setNotice("Your password has been updated securely.");
  }

  if (loading) return <div className="mx-auto max-w-6xl px-5 py-24"><p className="text-sm font-bold text-coral">Loading your account…</p></div>;
  return (
    <section className="mx-auto max-w-6xl px-5 py-16">
      <div className="flex flex-col justify-between gap-6 border-b border-ink/10 pb-10 md:flex-row md:items-end"><div><p className="text-sm font-black uppercase tracking-[.2em] text-coral">Member account</p><h1 className="mt-3 text-5xl font-black tracking-[-.04em]">{displayName || "Welcome"}</h1><p className="mt-3 text-ink/65">{email}</p></div><button onClick={logout} className="rounded-full border border-ink/20 px-5 py-3 text-sm font-bold hover:border-coral hover:text-coral">Log out</button></div>
      {notice && <p role="status" className="mt-6 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</p>}
      <div className="mt-10 grid gap-5 md:grid-cols-3">
        <article className="rounded-3xl bg-white p-7 shadow-lg shadow-ink/5"><p className="text-sm font-bold text-ink/50">Account role</p><p className="mt-3 text-2xl font-black capitalize">{role.replace("_", " ")}</p><p className="mt-3 text-sm leading-6 text-ink/60">Role changes are controlled by secure server-side policies.</p></article>
        <article className="rounded-3xl bg-ink p-7 text-white shadow-lg shadow-ink/15 md:col-span-2"><p className="text-sm font-bold text-gold">Creator pathway</p><h2 className="mt-3 text-3xl font-black">Make room for your next story.</h2><p className="mt-3 max-w-xl leading-7 text-white/70">Creator registration and verification are being introduced in this stage. The protected workspace is ready for approved creators.</p><a href="/creator" className="mt-6 inline-flex rounded-full bg-gold px-5 py-3 font-bold text-ink hover:bg-coral hover:text-white">Open creator workspace</a></article>
      </div>
      <div className="mt-10 grid gap-5 md:grid-cols-2"><div className="rounded-3xl border border-ink/10 bg-white p-7"><p className="text-sm font-black uppercase tracking-[.18em] text-coral">Security</p><h2 className="mt-3 text-2xl font-black">Update your password</h2><p className="mt-3 text-sm leading-6 text-ink/60">Use at least eight characters. This works after a reset link or from your signed-in account.</p><form onSubmit={updatePassword} className="mt-5 flex flex-col gap-3 sm:flex-row"><input required minLength={8} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="New password" className="min-w-0 flex-1 rounded-full border border-ink/15 bg-sand px-4 py-3 outline-none focus:border-coral" /><button disabled={updatingPassword} className="rounded-full bg-ink px-5 py-3 font-bold text-white hover:bg-coral disabled:opacity-60">{updatingPassword ? "Saving…" : "Save password"}</button></form></div><div className="rounded-3xl border border-ink/10 bg-white/50 p-7"><p className="text-sm font-black uppercase tracking-[.18em] text-coral">Viewer tools</p><h2 className="mt-3 text-3xl font-black">Your watchlist is coming next.</h2><p className="mt-3 max-w-2xl leading-7 text-ink/65">Browse, search, wishlist, and film entitlements will be introduced in the catalogue stage. Your authenticated account is ready for that next chapter.</p></div></div>
    </section>
  );
}
