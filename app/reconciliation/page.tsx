"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, ClipboardCheck, Printer, RefreshCw, Send, ShieldAlert } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { gh } from "@/lib/transactions";

const LINES = [
  ["PHYSICAL_CASH", "Physical cash"],
  ["MTN_FLOAT", "MTN Mobile Money float"],
  ["TELECEL_FLOAT", "Telecel Cash float"],
  ["AT_FLOAT", "AT Money float"],
] as const;
type LineCode = typeof LINES[number][0];
type Status = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";
type Session = { id: string; business_id: string; booth_id: string; business_date: string; cutoff_at: string; status: Status; notes: string | null; review_comment: string | null; prepared_by: string; };
type Line = { line_code: LineCode; expected_pesewas: number; actual_pesewas: number | null };

function toPesewas(value: string) { if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) return null; const [whole, fraction = ""] = value.trim().split("."); const amount = Number(`${whole}${fraction.padEnd(2, "0")}`); return Number.isSafeInteger(amount) ? amount : null; }
function fromPesewas(value: number | null) { return value == null ? "" : (value / 100).toFixed(2); }
function variance(expected: number, actual: number | null) { return actual == null ? null : actual - expected; }
function varianceLabel(value: number | null) { return value == null ? "NOT COUNTED" : value === 0 ? "BALANCED" : value < 0 ? "SHORTAGE" : "SURPLUS"; }

export default function ReconciliationPage() {
  const supabase = useMemo(() => createClient(), []);
  const [business, setBusiness] = useState<{ id: string; name: string } | null>(null);
  const [booths, setBooths] = useState<{ id: string; name: string }[]>([]);
  const [role, setRole] = useState("ATTENDANT");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [date, setDate] = useState(new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Accra" }));
  const [boothId, setBoothId] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [preparerFilter, setPreparerFilter] = useState("");
  const [notes, setNotes] = useState("");
  const [comment, setComment] = useState("");
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) return;
    setMessage(null);
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;
    const membership = await supabase.from("business_members").select("business_id, booth_id, role, businesses(id,name)").eq("user_id", userData.user.id).eq("status", "active").limit(1).maybeSingle();
    if (membership.error || !membership.data) { setMessage({ type: "error", text: membership.error?.message ?? "No active business membership found." }); return; }
    const membershipData = membership.data;
    const b = Array.isArray(membershipData.businesses) ? membershipData.businesses[0] : membershipData.businesses;
    setBusiness(b as { id: string; name: string }); setRole(membershipData.role);
    const boothQuery = supabase.from("booths").select("id,name").eq("business_id", membershipData.business_id).eq("status", "ACTIVE").order("name");
    const boothResult = await boothQuery;
    const available = (boothResult.data ?? []).filter((booth) => membershipData.role === "OWNER" || booth.id === membershipData.booth_id);
    setBooths(available); if (!boothId && available[0]) setBoothId(available[0].id);
    const history = await supabase.from("reconciliation_sessions").select("id,business_id,booth_id,business_date,cutoff_at,status,notes,review_comment,prepared_by").eq("business_id", membershipData.business_id).order("business_date", { ascending: false }).limit(100);
    setSessions((history.data ?? []) as Session[]);
  }, [supabase, boothId]);

  useEffect(() => { void load(); }, [load]);

  async function openSession() {
    if (!supabase || !business || !boothId || !date) return;
    setBusy(true); setMessage(null);
    const result = await supabase.rpc("start_reconciliation", { target_business_id: business.id, target_booth_id: boothId, target_business_date: date });
    if (result.error) setMessage({ type: "error", text: result.error.message });
    else { await loadSession(result.data.session_id); await load(); }
    setBusy(false);
  }
  async function loadSession(id: string) {
    if (!supabase) return;
    const [s, l] = await Promise.all([supabase.from("reconciliation_sessions").select("id,business_id,booth_id,business_date,cutoff_at,status,notes,review_comment,prepared_by").eq("id", id).single(), supabase.from("reconciliation_lines").select("line_code,expected_pesewas,actual_pesewas").eq("session_id", id).order("line_code")]);
    if (s.error || !s.data) { setMessage({ type: "error", text: s.error?.message ?? "Session not found." }); return; }
    setSession(s.data as Session); setLines((l.data ?? []) as Line[]); setNotes(s.data.notes ?? ""); setComment(s.data.review_comment ?? "");
  }
  async function save(submit = false) {
    if (!supabase || !session) return;
    const values = LINES.map(([code]) => { const line = lines.find((item) => item.line_code === code); return line?.actual_pesewas ?? null; });
    if (values.some((value) => value == null)) { setMessage({ type: "error", text: "Count every balance before saving or submitting." }); return; }
    setBusy(true); setMessage(null);
    const saved = await supabase.rpc("save_reconciliation_draft", { target_session_id: session.id, physical_cash_pesewas: values[0], mtn_float_pesewas: values[1], telecel_float_pesewas: values[2], at_float_pesewas: values[3], target_notes: notes || null });
    if (saved.error) setMessage({ type: "error", text: saved.error.message });
    else if (submit) { const submitted = await supabase.rpc("submit_reconciliation", { target_session_id: session.id }); if (submitted.error) setMessage({ type: "error", text: submitted.error.message }); else { setMessage({ type: "success", text: "Closing submitted for owner review." }); await loadSession(session.id); await load(); } }
    else { setMessage({ type: "success", text: "Draft saved." }); await loadSession(session.id); await load(); }
    setBusy(false);
  }
  async function review(decision: "APPROVE" | "REJECT") {
    if (!supabase || !session) return;
    setBusy(true); const result = await supabase.rpc("review_reconciliation", { target_session_id: session.id, decision, target_comment: comment || null });
    if (result.error) setMessage({ type: "error", text: result.error.message }); else { setMessage({ type: "success", text: decision === "APPROVE" ? "Closing approved and locked." : "Closing rejected. The preparer can correct and resubmit." }); await loadSession(session.id); await load(); }
    setBusy(false);
  }
  const visibleSessions = sessions.filter((item) => (statusFilter === "ALL" || item.status === statusFilter) && (!preparerFilter || item.prepared_by.includes(preparerFilter)));
  const boothName = (id: string) => booths.find((item) => item.id === id)?.name ?? "Booth";
  const editable = session && session.status !== "APPROVED" && session.status !== "SUBMITTED";
  const canReview = role === "OWNER" && session?.status === "SUBMITTED";

  return <div className="space-y-6 print:space-y-3">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="eyebrow">Daily close</p><h1 className="page-title">Reconciliation</h1><p className="page-subtitle">Compare the ledger position with the cash and float counted at close.</p></div><button onClick={() => window.print()} className="secondary-button"><Printer size={16} /> Print report</button></div>
    {message && <div className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${message.type === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>{message.text}</div>}
    <section className="surface p-5"><div className="mb-4 flex items-center gap-2"><ClipboardCheck size={18} className="text-[var(--teal)]" /><h2 className="section-title">Start or continue a closing</h2></div><div className="grid gap-4 md:grid-cols-[1fr_1fr_auto]"><label className="field-label">Business date<input className="field-input mt-2" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label><label className="field-label">Booth<select className="field-input mt-2" value={boothId} onChange={(e) => setBoothId(e.target.value)}>{booths.map((booth) => <option key={booth.id} value={booth.id}>{booth.name}</option>)}</select></label><button disabled={busy || !boothId} onClick={openSession} className="primary-button self-end">{busy ? "Opening…" : "Open closing"}</button></div><p className="mt-3 text-xs text-[var(--muted)]">The cutoff is the next midnight in Africa/Accra. Later postings cannot change this closing’s expected values.</p></section>
    {session && <section className="surface printable-report p-5"><div className="flex flex-col justify-between gap-3 border-b border-[var(--line)] pb-4 sm:flex-row"><div><p className="eyebrow">{session.business_date} · {boothName(session.booth_id)}</p><h2 className="section-title">Closing report</h2><p className="mt-1 text-xs text-[var(--muted)]">Cutoff: {new Date(session.cutoff_at).toLocaleString("en-GH", { timeZone: "Africa/Accra" })} · Status: <strong>{session.status}</strong></p></div><span className={`status-pill ${session.status === "APPROVED" ? "status-success" : session.status === "REJECTED" ? "status-danger" : "status-pending"}`}>{session.status}</span></div><div className="mt-5 grid gap-3 md:grid-cols-2">{LINES.map(([code, label]) => { const line = lines.find((item) => item.line_code === code); const diff = variance(line?.expected_pesewas ?? 0, line?.actual_pesewas ?? null); return <div key={code} className="rounded-2xl border border-[var(--line)] bg-[var(--canvas)] p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-bold">{label}</p><p className="mt-1 text-xs text-[var(--muted)]">Expected <strong>{gh(line?.expected_pesewas)}</strong></p></div><span className={`status-pill ${diff === 0 ? "status-success" : diff == null ? "status-pending" : "status-danger"}`}>{varianceLabel(diff)}</span></div><div className="mt-3 grid grid-cols-2 gap-3"><div><p className="field-label">Actual counted</p><input disabled={!editable} className="field-input mt-1" inputMode="decimal" value={fromPesewas(line?.actual_pesewas ?? null)} onChange={(e) => { const amount = e.target.value === "" ? null : toPesewas(e.target.value); setLines((current) => current.map((item) => item.line_code === code ? { ...item, actual_pesewas: amount } : item)); }} placeholder="0.00" /></div><div><p className="field-label">Variance</p><p className={`mt-2 text-lg font-black ${diff === 0 ? "text-emerald-700" : diff == null ? "text-[var(--muted)]" : "text-red-700"}`}>{diff == null ? "—" : `${diff < 0 ? "-" : "+"}${gh(Math.abs(diff))}`}</p></div></div></div>; })}</div><label className="field-label mt-5 block">Notes<textarea disabled={!editable} className="field-input mt-2 min-h-20" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Explain any operational context for the owner…" /></label>{session.review_comment && <div className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><strong>Owner review:</strong> {session.review_comment}</div>}<div className="mt-5 flex flex-wrap gap-3">{editable && <><button disabled={busy} onClick={() => save(false)} className="secondary-button">Save draft</button><button disabled={busy} onClick={() => save(true)} className="primary-button"><Send size={16} /> Submit closing</button></>}{canReview && <><input className="field-input max-w-sm" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Review comment (optional)" /><button disabled={busy} onClick={() => review("REJECT")} className="secondary-button text-red-700">Reject</button><button disabled={busy} onClick={() => review("APPROVE")} className="primary-button"><CheckCircle2 size={16} /> Approve and lock</button></>}</div></section>}
    <section className="surface p-5"><div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><p className="eyebrow">Audit trail</p><h2 className="section-title">Closing history</h2></div><div className="flex gap-2"><select className="field-input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="ALL">All statuses</option>{["DRAFT","SUBMITTED","APPROVED","REJECTED"].map((value) => <option key={value}>{value}</option>)}</select><input className="field-input max-w-44" value={preparerFilter} onChange={(e) => setPreparerFilter(e.target.value)} placeholder="Preparer ID" /><button aria-label="Refresh history" onClick={() => load()} className="secondary-button px-3"><RefreshCw size={16} /></button></div></div>{visibleSessions.length === 0 ? <div className="rounded-2xl bg-[var(--canvas)] p-6 text-center text-sm text-[var(--muted)]"><ShieldAlert className="mx-auto mb-2 text-[var(--teal)]" />No reconciliation sessions match these filters.</div> : <div className="overflow-x-auto"><table className="data-table"><thead><tr><th>Date</th><th>Booth</th><th>Status</th><th>Prepared by</th><th /></tr></thead><tbody>{visibleSessions.map((item) => <tr key={item.id}><td className="font-semibold">{item.business_date}</td><td>{boothName(item.booth_id)}</td><td><span className="status-pill status-pending">{item.status}</span></td><td className="font-mono text-xs">{item.prepared_by.slice(0, 8)}…</td><td><button className="text-sm font-bold text-[var(--teal)]" onClick={() => loadSession(item.id)}>View</button></td></tr>)}</tbody></table></div>}</section>
  </div>;
}
