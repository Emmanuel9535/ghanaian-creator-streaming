"use client";

import { useEffect, useState } from "react";

const demoAmount = 2500;

export default function CheckoutPage() {
  const [reference, setReference] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "starting" | "verifying" | "success" | "pending" | "failed">("idle");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const queryReference = new URLSearchParams(window.location.search).get("reference");
    if (!queryReference) return;
    setReference(queryReference);
    setStatus("verifying");
    fetch("/api/payments/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reference: queryReference }) })
      .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error || "Verification failed."); return data; })
      .then((data) => { setStatus(data.status === "success" ? "success" : data.status === "pending" ? "pending" : "failed"); setMessage(data.message); })
      .catch((error) => { setStatus("failed"); setMessage(error instanceof Error ? error.message : "Verification failed."); });
  }, []);

  async function startCheckout() {
    setStatus("starting");
    setMessage(null);
    const response = await fetch("/api/payments/initialize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount: demoAmount, film_id: "demo-film" }) });
    const data = await response.json();
    if (!response.ok) { setStatus("failed"); setMessage(data.error || "Checkout could not be started."); return; }
    window.location.href = data.authorization_url;
  }

  const accent = status === "success" ? "text-emerald-600" : status === "failed" ? "text-red-600" : "text-coral";
  return <section className="mx-auto grid max-w-6xl gap-12 px-5 py-16 md:grid-cols-[1.1fr_.9fr] md:items-center"><div><p className="text-sm font-black uppercase tracking-[.22em] text-coral">Secure test checkout</p><h1 className="mt-4 text-5xl font-black leading-none tracking-[-.04em] md:text-7xl">Back the next<br /><span className="text-coral">Ghanaian story.</span></h1><p className="mt-6 max-w-xl text-lg leading-8 text-ink/65">This checkout is wired to Paystack test mode. No real money is moved, and payment value is not delivered until the server verifies the transaction.</p><div className="mt-9 flex flex-wrap gap-3"><a href="/" className="rounded-full border border-ink/20 px-5 py-3 font-bold hover:border-coral hover:text-coral">Back home</a><a href="/account" className="rounded-full border border-ink/20 px-5 py-3 font-bold hover:border-coral hover:text-coral">Account</a></div></div><div className="rounded-[2rem] bg-ink p-7 text-white shadow-2xl shadow-ink/15 md:p-9"><div className="flex items-start justify-between gap-4"><div><p className="text-sm font-bold text-gold">Early access screening</p><h2 className="mt-3 text-3xl font-black">A Ghana First story</h2></div><span className="rounded-full bg-gold/15 px-3 py-1 text-xs font-black text-gold">TEST MODE</span></div><p className="mt-6 leading-7 text-white/65">A payment record is created for your signed-in account, then Paystack handles the secure checkout page.</p><div className="mt-8 flex items-end justify-between border-t border-white/10 pt-6"><span className="text-sm text-white/55">Screening pass</span><span className="text-4xl font-black">GH₵25</span></div><button onClick={startCheckout} disabled={status === "starting" || status === "verifying"} className="mt-7 w-full rounded-full bg-coral px-5 py-3 font-bold text-white hover:bg-gold hover:text-ink disabled:cursor-wait disabled:opacity-60">{status === "starting" ? "Opening Paystack…" : status === "verifying" ? "Verifying payment…" : "Continue to Paystack"}</button>{message && <p role="status" className={`mt-5 rounded-xl bg-white/10 px-4 py-3 text-sm ${accent}`}>{message}{reference && <span className="mt-2 block break-all text-xs text-white/45">Reference: {reference}</span>}</p>}</div></section>;
}
