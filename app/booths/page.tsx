"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase";

type Business = { id: string; name: string };
type Booth = {
  id: string;
  name: string;
  location: string;
  description: string | null;
  status: "active" | "inactive";
  created_at: string;
};
type Notice = { type: "error" | "success"; text: string } | null;
type AccessState = "checking" | "owner" | "denied" | "no-business" | "not-configured" | "error";

const emptyForm = { name: "", location: "", description: "" };
const boothColumns = "id,name,location,description,status,created_at";

export default function BoothsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [accessState, setAccessState] = useState<AccessState>("checking");
  const [business, setBusiness] = useState<Business | null>(null);
  const [booths, setBooths] = useState<Booth[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!supabase) {
        setAccessState("not-configured");
        return;
      }

      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (cancelled) return;
      if (userError || !user) {
        window.location.href = "/auth?next=%2Fbooths";
        return;
      }

      const { data: ownedBusiness, error: businessError } = await supabase
        .from("businesses")
        .select("id,name")
        .eq("owner_id", user.id)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (cancelled) return;
      if (businessError) {
        setNotice({ type: "error", text: "We couldn’t load your business. Please refresh and try again." });
        setAccessState("error");
        return;
      }
      if (!ownedBusiness) {
        setAccessState("no-business");
        return;
      }

      setBusiness(ownedBusiness);
      const { data: boothRows, error: boothsError } = await supabase
        .from("booths")
        .select(boothColumns)
        .eq("business_id", ownedBusiness.id)
        .order("created_at", { ascending: true })
        .limit(500);

      if (cancelled) return;
      if (boothsError) {
        setNotice({ type: "error", text: "We couldn’t load your booths. Please refresh and try again." });
        setAccessState("error");
        return;
      }

      setBooths((boothRows ?? []) as Booth[]);
      setAccessState("owner");
    }

    void load();
    return () => { cancelled = true; };
  }, [supabase]);

  function startEditing(booth: Booth) {
    setEditingId(booth.id);
    setForm({ name: booth.name, location: booth.location, description: booth.description ?? "" });
    setNotice(null);
    document.getElementById("booth-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function cancelEditing() {
    setEditingId(null);
    setForm(emptyForm);
    setNotice(null);
  }

  async function saveBooth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !business || accessState !== "owner") return;

    const name = form.name.trim();
    const location = form.location.trim();
    const description = form.description.trim();
    if (name.length < 2 || name.length > 120 || location.length < 2 || location.length > 180) {
      setNotice({ type: "error", text: "Enter a booth name (2–120 characters) and location (2–180 characters)." });
      return;
    }
    if (editingId && !booths.some((booth) => booth.id === editingId)) {
      setNotice({ type: "error", text: "That booth is no longer available. Refresh the page and try again." });
      return;
    }

    setBusy(true);
    setNotice(null);
    const boothValues = { name, location, description: description || null };
    const result = editingId
      ? await supabase.from("booths").update(boothValues).eq("id", editingId).eq("business_id", business.id).select(boothColumns).single()
      : await supabase.from("booths").insert({ ...boothValues, business_id: business.id }).select(boothColumns).single();
    setBusy(false);

    if (result.error) {
      setNotice({
        type: "error",
        text: result.error.code === "23505"
          ? "A booth with that name already exists for this business. Choose a different name."
          : "We couldn’t save this booth. Please try again.",
      });
      return;
    }

    const savedBooth = result.data as Booth;
    setBooths((current) => {
      const next = editingId
        ? current.map((booth) => booth.id === editingId ? savedBooth : booth)
        : [...current, savedBooth];
      return next.sort((a, b) => a.created_at.localeCompare(b.created_at));
    });
    setNotice({ type: "success", text: editingId ? "Booth details updated." : "New booth created." });
    setEditingId(null);
    setForm(emptyForm);
  }

  if (accessState === "checking") {
    return <section className="mx-auto max-w-3xl py-12"><p className="eyebrow">Owner tools</p><p className="mt-3 text-sm text-slate-500">Checking secure booth access…</p></section>;
  }

  if (accessState === "not-configured") {
    return <section className="mx-auto max-w-3xl py-12"><div className="surface p-7"><p className="eyebrow">Owner tools</p><h1 className="mt-3 text-2xl font-black">Secure access is not configured</h1><p className="mt-3 text-sm leading-6 text-slate-500">Booth management needs the existing Supabase sign-in connection.</p></div></section>;
  }

  if (accessState !== "owner") {
    const title = accessState === "denied" ? "Owner access required" : accessState === "no-business" ? "Complete workspace setup first" : "Booths are unavailable";
    const description = accessState === "denied"
      ? "Only an active owner of this business can create or edit booths. Attendants cannot change the owner’s booth records."
      : accessState === "no-business"
        ? "Create your business workspace before managing its booths."
        : notice?.text ?? "We couldn’t verify your booth access.";
    return <section className="mx-auto max-w-3xl py-12"><div className="surface p-7"><p className="eyebrow">Owner tools</p><h1 className="mt-3 text-2xl font-black">{title}</h1><p className="mt-3 text-sm leading-6 text-slate-500">{description}</p>{accessState === "no-business" && <Link href="/setup" className="primary-button mt-6 inline-flex">Open workspace setup</Link>}<Link href="/dashboard" className="secondary-button mt-6 inline-flex">Back to dashboard</Link></div></section>;
  }

  return <div className="space-y-7">
    <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <p className="eyebrow">Owner tools · {business?.name}</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Booth management</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">Add locations as your day-to-day needs change, or update an existing booth. Booth records stay separate from your business profile and original opening balances.</p>
      </div>
      <Link href="/dashboard" className="secondary-button w-fit">Back to dashboard</Link>
    </section>

    {notice && <div role="status" aria-live="polite" className={`rounded-xl px-4 py-3 text-sm leading-6 ${notice.type === "error" ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>{notice.text}</div>}

    <section id="booth-form" className="surface scroll-mt-24 p-5 sm:p-7">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div><p className="eyebrow">{editingId ? "Edit booth" : "Add a location"}</p><h2 className="mt-2 text-xl font-black text-slate-950">{editingId ? "Update booth details" : "Create a new booth"}</h2><p className="mt-2 text-sm leading-6 text-slate-500">This changes booth details only. Owner profile, business settings and opening balances are not changed.</p></div>
        {editingId && <button type="button" onClick={cancelEditing} className="secondary-button w-fit">Cancel edit</button>}
      </div>
      <form onSubmit={saveBooth} className="mt-6 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-bold text-slate-700">Booth name<input required minLength={2} maxLength={120} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Madina Market Booth" className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-sky-400" /></label>
        <label className="text-sm font-bold text-slate-700">Location<input required minLength={2} maxLength={180} value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="e.g. Near the main market entrance" className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-sky-400" /></label>
        <label className="text-sm font-bold text-slate-700 sm:col-span-2">Description <span className="font-normal text-slate-400">(optional)</span><textarea maxLength={500} rows={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Add a short note to help identify this booth." className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-sky-400" /></label>
        <div className="flex flex-wrap gap-3 sm:col-span-2"><button disabled={busy} className="primary-button">{busy ? "Saving…" : editingId ? "Save booth changes" : "Create booth"}</button>{!editingId && <button type="button" onClick={() => setForm(emptyForm)} disabled={busy} className="secondary-button">Clear form</button>}</div>
      </form>
    </section>

    <section className="surface overflow-hidden">
      <div className="border-b border-slate-200 px-5 py-5"><p className="eyebrow">{booths.length} {booths.length === 1 ? "booth" : "booths"}</p><h2 className="mt-2 text-xl font-black text-slate-950">Your business locations</h2></div>
      {booths.length === 0
        ? <div className="p-10 text-center"><h3 className="font-bold text-slate-900">No booths yet</h3><p className="mt-2 text-sm text-slate-500">Use the form above to create the first booth for this business.</p></div>
        : <div className="divide-y divide-slate-100">{booths.map((booth) => <article key={booth.id} className="flex flex-col justify-between gap-4 px-5 py-5 sm:flex-row sm:items-center"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-bold text-slate-950">{booth.name}</h3><span className={`rounded-full px-2.5 py-1 text-xs font-bold capitalize ${booth.status === "active" ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-500"}`}>{booth.status}</span></div><p className="mt-1 text-sm text-slate-600">{booth.location}</p>{booth.description && <p className="mt-2 text-sm leading-6 text-slate-500">{booth.description}</p>}<p className="mt-2 text-xs text-slate-400">Added {new Date(booth.created_at).toLocaleDateString("en-GH", { dateStyle: "medium" })}</p></div><button type="button" onClick={() => startEditing(booth)} className="secondary-button w-fit">Edit booth</button></article>)}</div>}
    </section>
  </div>;
}
