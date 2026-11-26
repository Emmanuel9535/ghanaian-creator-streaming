"use client";

import { FormEvent, Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { getAppUrl } from "@/lib/app-url";

function validPhone(value: string) { return /^(?:\+?[1-9]\d{7,14}|0\d{9})$/.test(value.replace(/[\s()-]/g, "")); }
function validPassword(value: string) { return /^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(value); }

function AuthForm() {
  const supabase = useMemo(() => createClient(), []);
  const searchParams = useSearchParams();
  const [mode, setMode] = useState(searchParams.get("mode") === "register" ? "register" : searchParams.get("mode") === "recovery" ? "recovery" : "login");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [notice, setNotice] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (searchParams.get("mode")) setMode(searchParams.get("mode")!); }, [searchParams]);
  const isRegister = mode === "register";
  const isRecovery = mode === "recovery";
  const isReset = mode === "reset";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setNotice(null);
    if (!supabase) { setNotice({ type: "error", text: "Authentication is not configured in this environment yet." }); return; }
    if (isRegister) {
      if (fullName.trim().length < 2) return setNotice({ type: "error", text: "Enter your full name." });
      if (!validPhone(phone)) return setNotice({ type: "error", text: "Enter a valid Ghanaian phone number, such as 024 123 4567, or a supported international format." });
      if (!validPassword(password)) return setNotice({ type: "error", text: "Use at least 8 characters with at least one letter and one number." });
      if (password !== confirmation) return setNotice({ type: "error", text: "Passwords do not match." });
    }
    if (isReset && !validPassword(password)) return setNotice({ type: "error", text: "Use at least 8 characters with at least one letter and one number." });
    setBusy(true);
    if (isRegister) {
      const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { data: { full_name: fullName.trim(), phone: phone.trim() }, emailRedirectTo: `${getAppUrl()}/auth/callback?next=/setup` } });
      setBusy(false);
      if (error) { setNotice({ type: "error", text: error.message }); return; }
      if (data.session) window.location.href = "/setup";
      else { setMode("login"); setNotice({ type: "success", text: "Account created. Check your email to verify your address, then log in to continue setup." }); }
      return;
    }
    if (isRecovery) {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${getAppUrl()}/auth?mode=reset` });
      setBusy(false); setNotice(error ? { type: "error", text: error.message } : { type: "success", text: "If an account exists for that email, a password reset link is on its way." }); return;
    }
    if (isReset) {
      const { error } = await supabase.auth.updateUser({ password });
      setBusy(false); setNotice(error ? { type: "error", text: error.message } : { type: "success", text: "Password updated. You can continue to your workspace." }); if (!error) setTimeout(() => { window.location.href = "/setup"; }, 700); return;
    }
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false); if (error) setNotice({ type: "error", text: error.message }); else window.location.href = "/setup";
  }

  const title = isRegister ? "Create your owner account" : isRecovery ? "Recover your account" : isReset ? "Choose a new password" : "Welcome back";
  return <main className="min-h-[calc(100vh-80px)] bg-slate-50 px-4 py-10 sm:px-6"><div className="mx-auto grid max-w-5xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm lg:grid-cols-[.85fr_1.15fr]"><section className="bg-navy p-7 text-white sm:p-10"><Link href="/" className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-sky-400 font-black text-slate-950">M</span><span className="text-lg font-black">MoMo Ledger</span></Link><div className="mt-16 max-w-sm"><p className="eyebrow text-sky-200">Secure workspace access</p><h1 className="mt-4 text-3xl font-black leading-tight sm:text-4xl">A calmer way to run your MoMo business.</h1><p className="mt-5 text-sm leading-7 text-slate-300">Create an owner workspace, set your opening position and prepare your booth for the next stage of transaction recording.</p></div></section><section className="p-6 sm:p-10"><p className="eyebrow">{isRegister ? "Owner registration" : "Account access"}</p><h2 className="mt-2 text-2xl font-black text-slate-950">{title}</h2>{isRegister && <p className="mt-2 text-sm leading-6 text-slate-500">Your password is handled securely by Supabase Auth and never stored in the MoMo Ledger database.</p>}{notice && <div role="status" className={`mt-5 rounded-xl px-4 py-3 text-sm leading-6 ${notice.type === "error" ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>{notice.text}</div>}<form onSubmit={submit} className="mt-7 space-y-4">{isRegister && <><label className="block text-sm font-bold text-slate-700">Full name<input required value={fullName} onChange={e => setFullName(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-sky-400" autoComplete="name" /></label><label className="block text-sm font-bold text-slate-700">Phone number<input required value={phone} onChange={e => setPhone(e.target.value)} placeholder="024 123 4567" className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-sky-400" autoComplete="tel" /></label></>}{!isReset && <label className="block text-sm font-bold text-slate-700">Email address<input required type="email" value={email} onChange={e => setEmail(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-sky-400" autoComplete="email" /></label>}{(!isRecovery || isReset || isRegister) && <label className="block text-sm font-bold text-slate-700">{isReset ? "New password" : "Password"}<input required type="password" value={password} onChange={e => setPassword(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-sky-400" autoComplete={isRegister ? "new-password" : "current-password"} />{(isRegister || isReset) && <span className="mt-1 block text-xs font-normal text-slate-500">At least 8 characters, including a letter and a number.</span>}</label>}{isRegister && <label className="block text-sm font-bold text-slate-700">Confirm password<input required type="password" value={confirmation} onChange={e => setConfirmation(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-sky-400" autoComplete="new-password" /></label>}<button disabled={busy} className="primary-button w-full disabled:cursor-wait disabled:opacity-60">{busy ? "Working…" : isRegister ? "Create owner account" : isRecovery ? "Send recovery link" : isReset ? "Update password" : "Log in"}</button></form><div className="mt-6 flex flex-wrap justify-between gap-3 text-sm">{!isReset && <button type="button" onClick={() => { setMode(isRegister ? "login" : "register"); setNotice(null); }} className="font-bold text-sky-600 hover:text-slate-950">{isRegister ? "Already have an account? Log in" : "Create an owner account"}</button>}{mode === "login" && <button type="button" onClick={() => { setMode("recovery"); setNotice(null); }} className="font-bold text-slate-500 hover:text-slate-950">Forgot password?</button>}{(isRecovery || isReset) && <button type="button" onClick={() => { setMode("login"); setNotice(null); }} className="font-bold text-slate-500 hover:text-slate-950">Back to login</button>}</div></section></div></main>;
}

export default function AuthPage() {
  return <Suspense fallback={<main className="grid min-h-[calc(100vh-80px)] place-items-center bg-slate-50"><p className="text-sm text-slate-500">Loading secure access…</p></main>}><AuthForm /></Suspense>;
}
