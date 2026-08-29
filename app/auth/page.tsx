"use client";

import { FormEvent, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase";

export default function AuthPage() {
  const supabase = useMemo(() => createClient(), []);
  const [mode, setMode] = useState<"login" | "signup" | "reset">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setStatus(null);
    if (!supabase) {
      setError("Supabase is not configured for this deployment yet.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "reset") {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/auth/callback?next=/account` });
        if (resetError) throw resetError;
        setStatus("If an account exists for that email, a password-reset link has been sent.");
      } else if (mode === "signup") {
        const { data, error: signUpError } = await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName } } });
        if (signUpError) throw signUpError;
        setStatus(data.session ? "Your account is ready. You can open your account area." : "Account created. Check your email to confirm your address before signing in.");
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
        window.location.href = "/account";
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Authentication could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  const title = mode === "signup" ? "Create your account" : mode === "reset" ? "Reset your password" : "Welcome back";
  return (
    <section className="mx-auto grid min-h-[calc(100vh-180px)] max-w-6xl gap-10 px-5 py-16 md:grid-cols-[.85fr_1.15fr] md:items-center">
      <div><p className="text-sm font-black uppercase tracking-[.22em] text-coral">Ghana First access</p><h1 className="mt-4 text-5xl font-black leading-none tracking-[-.04em] md:text-7xl">Your screen.<br /><span className="text-coral">Your story.</span></h1><p className="mt-6 max-w-md text-lg leading-8 text-ink/65">Create an account to save films, follow creators, and unlock the creator workspace.</p></div>
      <div className="rounded-[2rem] bg-white p-7 shadow-xl shadow-ink/10 md:p-10">
        <div className="flex gap-2 border-b border-ink/10 pb-5 text-sm font-bold">
          <button onClick={() => setMode("login")} className={`rounded-full px-4 py-2 ${mode === "login" ? "bg-ink text-white" : "text-ink/60 hover:text-coral"}`}>Log in</button>
          <button onClick={() => setMode("signup")} className={`rounded-full px-4 py-2 ${mode === "signup" ? "bg-ink text-white" : "text-ink/60 hover:text-coral"}`}>Register</button>
        </div>
        <h2 className="mt-8 text-3xl font-black">{title}</h2>
        <p className="mt-2 text-sm text-ink/60">{mode === "reset" ? "We will send a secure link to your email." : "One account for viewers and creators."}</p>
        <form onSubmit={submit} className="mt-7 space-y-4">
          {mode === "signup" && <label className="block text-sm font-bold">Full name<input required value={fullName} onChange={(event) => setFullName(event.target.value)} className="mt-2 w-full rounded-xl border border-ink/15 bg-sand px-4 py-3 font-normal outline-none focus:border-coral" /></label>}
          <label className="block text-sm font-bold">Email<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-2 w-full rounded-xl border border-ink/15 bg-sand px-4 py-3 font-normal outline-none focus:border-coral" /></label>
          {mode !== "reset" && <label className="block text-sm font-bold">Password<input required minLength={8} type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 w-full rounded-xl border border-ink/15 bg-sand px-4 py-3 font-normal outline-none focus:border-coral" /></label>}
          {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
          {status && <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{status}</p>}
          <button disabled={busy} className="w-full rounded-full bg-coral px-5 py-3 font-bold text-white hover:bg-ink disabled:cursor-wait disabled:opacity-60">{busy ? "Working…" : mode === "signup" ? "Create account" : mode === "reset" ? "Send reset link" : "Log in"}</button>
        </form>
        <button onClick={() => { setError(null); setStatus(null); setMode(mode === "reset" ? "login" : "reset"); }} className="mt-5 text-sm font-bold text-coral hover:text-ink">{mode === "reset" ? "Back to login" : "Forgot your password?"}</button>
      </div>
    </section>
  );
}
