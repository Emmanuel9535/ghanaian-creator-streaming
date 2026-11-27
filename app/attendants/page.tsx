"use client";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Activity, CheckCircle2, ContactRound, MailPlus, PauseCircle, PlayCircle, RefreshCw, ShieldCheck, Users, XCircle } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { gh, maskPhone, networkLabel, typeLabel } from "@/lib/transactions";
import { resolveActiveWorkspace, type ActiveWorkspace } from "@/lib/workspace";

type Booth = { id: string; name: string; location: string };
type Invitation = { id: string; booth_id: string | null; email: string; full_name: string; phone: string; status: string; expires_at: string; created_at: string };
type Member = { id: string; user_id: string; booth_id: string | null; role: "OWNER" | "ATTENDANT"; status: "active" | "suspended" | "pending"; created_at: string };
type ActivityRow = { id: string; transaction_number: number; internal_reference: string; booth_id: string; customer_phone: string; network: string; transaction_type: string; principal_amount_pesewas: number; transaction_status: string; transaction_at: string };

export default function AttendantsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [workspace, setWorkspace] = useState<ActiveWorkspace | null>(null);
  const [booths, setBooths] = useState<Booth[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [invite, setInvite] = useState({ full_name: "", email: "", phone: "", booth_id: "" });

  const load = useCallback(async () => {
    if (!supabase) { setLoading(false); setNotice({ type: "error", text: "Authentication is not configured." }); return; }
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); setNotice({ type: "error", text: "Please sign in to access attendant operations." }); return; }
    const resolved = await resolveActiveWorkspace(supabase, user.id);
    if (resolved.error) { setLoading(false); setNotice({ type: "error", text: resolved.error }); return; }
    if (!resolved.workspace) { setLoading(false); setNotice({ type: "error", text: "No active business workspace is available." }); return; }
    const current = resolved.workspace;
    setWorkspace(current);
    const boothQuery = supabase.from("booths").select("id,name,location").eq("business_id", current.business.id).eq("status", "active").order("created_at");
    const memberQuery = supabase.from("business_members").select("id,user_id,booth_id,role,status,created_at").eq("business_id", current.business.id).order("created_at");
    const activityQuery = supabase.from("transactions").select("id,transaction_number,internal_reference,booth_id,customer_phone,network,transaction_type,principal_amount_pesewas,transaction_status,transaction_at").eq("business_id", current.business.id).order("transaction_at", { ascending: false }).limit(8);
    const [boothResult, memberResult, activityResult] = await Promise.all([
      boothQuery,
      current.role === "OWNER" ? memberQuery : supabase.from("business_members").select("id,user_id,booth_id,role,status,created_at").eq("id", "00000000-0000-0000-0000-000000000000"),
      current.role === "OWNER" ? activityQuery : activityQuery.eq("booth_id", current.booth?.id ?? "00000000-0000-0000-0000-000000000000"),
    ]);
    if (boothResult.error || memberResult.error || activityResult.error) setNotice({ type: "error", text: boothResult.error?.message ?? memberResult.error?.message ?? activityResult.error?.message ?? "Attendant records could not be loaded." });
    setBooths((boothResult.data ?? []) as Booth[]);
    setMembers((memberResult.data ?? []) as Member[]);
    setActivity((activityResult.data ?? []) as ActivityRow[]);
    if (current.role === "OWNER") {
      const invitationResult = await supabase.from("invitations").select("id,booth_id,email,full_name,phone,status,expires_at,created_at").eq("business_id", current.business.id).order("created_at", { ascending: false });
      if (invitationResult.error) setNotice({ type: "error", text: invitationResult.error.message });
      setInvitations((invitationResult.data ?? []) as Invitation[]);
      setInvite((currentInvite) => ({ ...currentInvite, booth_id: currentInvite.booth_id || (boothResult.data?.[0]?.id ?? "") }));
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);

  async function createInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !workspace || workspace.role !== "OWNER") return;
    if (invite.full_name.trim().length < 2 || !invite.email.trim() || invite.phone.trim().length < 7 || !invite.booth_id) { setNotice({ type: "error", text: "Enter the attendant’s name, email, phone number and assigned booth." }); return; }
    setBusy(true); setNotice(null);
    const user = (await supabase.auth.getUser()).data.user;
    const result = await supabase.from("invitations").insert({ business_id: workspace.business.id, booth_id: invite.booth_id, full_name: invite.full_name.trim(), email: invite.email.trim().toLowerCase(), phone: invite.phone.trim(), invited_by: user?.id, role: "ATTENDANT" }).select("id,booth_id,email,full_name,phone,status,expires_at,created_at").single();
    setBusy(false);
    if (result.error) { setNotice({ type: "error", text: result.error.code === "23505" ? "A pending invitation already exists for this email." : result.error.message }); return; }
    setInvitations((current) => [result.data as Invitation, ...current]);
    setInvite({ full_name: "", email: "", phone: "", booth_id: invite.booth_id });
    setNotice({ type: "success", text: "Attendant invitation saved. Account activation still requires your configured invitation flow." });
  }

  async function updateMember(member: Member, status: "active" | "suspended") {
    if (!supabase || !workspace || workspace.role !== "OWNER") return;
    setBusy(true); setNotice(null);
    const result = await supabase.from("business_members").update({ status }).eq("id", member.id).eq("business_id", workspace.business.id).select("id,user_id,booth_id,role,status,created_at").single();
    setBusy(false);
    if (result.error) setNotice({ type: "error", text: result.error.message });
    else { setMembers((current) => current.map((item) => item.id === member.id ? result.data as Member : item)); setNotice({ type: "success", text: status === "active" ? "Attendant access restored." : "Attendant access suspended." }); }
  }

  async function updateInvitation(id: string, status: "cancelled" | "pending") {
    if (!supabase || !workspace || workspace.role !== "OWNER") return;
    setBusy(true); setNotice(null);
    const result = await supabase.from("invitations").update({ status }).eq("id", id).eq("business_id", workspace.business.id).select("id,booth_id,email,full_name,phone,status,expires_at,created_at").single();
    setBusy(false);
    if (result.error) setNotice({ type: "error", text: result.error.message });
    else { setInvitations((current) => current.map((item) => item.id === id ? result.data as Invitation : item)); setNotice({ type: "success", text: status === "cancelled" ? "Invitation cancelled." : "Invitation reopened." }); }
  }

  if (loading) return <main className="mx-auto max-w-5xl py-16"><p className="eyebrow">Team access</p><p className="mt-4 text-sm text-[var(--muted)]">Loading attendant workspace…</p></main>;
  if (!workspace) return <main className="mx-auto max-w-3xl py-16"><section className="surface p-7"><p className="eyebrow">Team access</p><h1 className="mt-2 text-3xl font-black text-[var(--teal-dark)]">Attendant access is unavailable</h1><p className="mt-3 text-sm leading-6 text-[var(--muted)]">{notice?.text ?? "Complete workspace setup or ask the owner to restore your membership."}</p><Link href="/setup" className="primary-button mt-6">Open workspace setup</Link></section></main>;

  const attendantMembers = members.filter((member) => member.role === "ATTENDANT");
  const boothName = (boothId: string | null) => booths.find((booth) => booth.id === boothId)?.name ?? "Unassigned booth";
  const invitationName = (member: Member) => invitations.find((item) => item.status === "accepted" && item.booth_id === member.booth_id)?.full_name ?? `Attendant · ${member.user_id.slice(0, 8)}`;
  const activeCount = attendantMembers.filter((member) => member.status === "active").length;

  return <div className="space-y-7">
    <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="eyebrow">Team access</p><h1 className="mt-2 text-3xl font-black tracking-tight text-[var(--teal-dark)]">Attendants</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">Keep each operator tied to the correct booth while preserving owner approvals and the existing financial ledger.</p></div><button type="button" onClick={() => void load()} className="secondary-button w-fit"><RefreshCw size={16} /> Refresh</button></section>
    {notice && <div role="status" className={`rounded-xl border px-4 py-3 text-sm ${notice.type === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{notice.text}</div>}
    <section className="grid gap-4 sm:grid-cols-3"><div className="surface p-5"><Users className="text-[var(--teal)]" size={22} /><p className="mt-4 text-sm text-[var(--muted)]">Active attendants</p><p className="mt-1 text-2xl font-black text-[var(--teal-dark)]">{workspace.role === "OWNER" ? activeCount : "—"}</p></div><div className="surface p-5"><ContactRound className="text-[var(--teal)]" size={22} /><p className="mt-4 text-sm text-[var(--muted)]">Your access</p><p className="mt-1 text-2xl font-black text-[var(--teal-dark)]">{workspace.role === "OWNER" ? "Owner" : "Attendant"}</p></div><div className="surface p-5"><ShieldCheck className="text-[var(--teal)]" size={22} /><p className="mt-4 text-sm text-[var(--muted)]">Assigned booth</p><p className="mt-1 truncate text-lg font-black text-[var(--teal-dark)]">{workspace.role === "OWNER" ? `${booths.length} available` : workspace.booth?.name ?? "Not assigned"}</p></div></section>
    {workspace.role === "OWNER" ? <>
      <section className="surface p-5 sm:p-6"><div className="flex items-start gap-3"><MailPlus className="mt-1 text-[var(--teal)]" size={21} /><div><p className="eyebrow">Owner control</p><h2 className="mt-1 text-xl font-black text-[var(--teal-dark)]">Invite an attendant</h2><p className="mt-1 text-sm text-[var(--muted)]">Save a booth-scoped invitation. Supabase RLS restricts this action to owners.</p></div></div><form onSubmit={createInvitation} className="mt-5 grid gap-3 sm:grid-cols-2"><label className="field"><span>Full name</span><input required value={invite.full_name} onChange={(event) => setInvite({ ...invite, full_name: event.target.value })} placeholder="Attendant name" /></label><label className="field"><span>Email address</span><input required type="email" value={invite.email} onChange={(event) => setInvite({ ...invite, email: event.target.value })} placeholder="attendant@example.com" /></label><label className="field"><span>Phone number</span><input required value={invite.phone} onChange={(event) => setInvite({ ...invite, phone: event.target.value })} placeholder="024 123 4567" /></label><label className="field"><span>Assigned booth</span><select required value={invite.booth_id} onChange={(event) => setInvite({ ...invite, booth_id: event.target.value })}><option value="">Choose booth</option>{booths.map((booth) => <option key={booth.id} value={booth.id}>{booth.name} · {booth.location}</option>)}</select></label><button disabled={busy} className="primary-button w-fit sm:col-span-2">{busy ? "Saving…" : "Save attendant invitation"}</button></form></section>
      <section className="surface overflow-hidden"><div className="border-b border-[var(--line)] p-5"><p className="eyebrow">Access controls</p><h2 className="mt-1 text-xl font-black text-[var(--teal-dark)]">Active memberships</h2></div>{attendantMembers.length === 0 ? <p className="p-7 text-sm text-[var(--muted)]">No accepted attendant memberships are visible yet. Pending invitations are listed below.</p> : <div className="divide-y divide-[var(--line)]">{attendantMembers.map((member) => <div key={member.id} className="flex flex-col justify-between gap-3 p-5 sm:flex-row sm:items-center"><div><p className="font-bold text-[var(--teal-dark)]">{invitationName(member)}</p><p className="mt-1 text-sm text-[var(--muted)]">{boothName(member.booth_id)} · Added {new Date(member.created_at).toLocaleDateString("en-GH")}</p></div><div className="flex items-center gap-2"><span className={`rounded-full px-3 py-1 text-xs font-bold ${member.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{member.status}</span>{member.status === "active" ? <button disabled={busy} type="button" className="secondary-button" onClick={() => void updateMember(member, "suspended")}><PauseCircle size={15} /> Suspend</button> : <button disabled={busy} type="button" className="primary-button" onClick={() => void updateMember(member, "active")}><PlayCircle size={15} /> Restore</button>}</div></div>)}</div>}</section>
      <section className="surface overflow-hidden"><div className="border-b border-[var(--line)] p-5"><p className="eyebrow">Invitation history</p><h2 className="mt-1 text-xl font-black text-[var(--teal-dark)]">Pending and previous invitations</h2></div>{invitations.length === 0 ? <p className="p-7 text-sm text-[var(--muted)]">No invitations have been saved.</p> : <div className="divide-y divide-[var(--line)]">{invitations.map((item) => <div key={item.id} className="flex flex-col justify-between gap-3 p-5 sm:flex-row sm:items-center"><div><p className="font-bold text-[var(--teal-dark)]">{item.full_name} · {item.email}</p><p className="mt-1 text-sm text-[var(--muted)]">{item.phone} · {boothName(item.booth_id)} · Expires {new Date(item.expires_at).toLocaleDateString("en-GH")}</p></div><div className="flex items-center gap-2"><span className={`rounded-full px-3 py-1 text-xs font-bold ${item.status === "accepted" ? "bg-emerald-50 text-emerald-700" : item.status === "cancelled" ? "bg-slate-100 text-slate-600" : "bg-amber-50 text-amber-700"}`}>{item.status}</span>{item.status === "pending" && <button disabled={busy} type="button" className="secondary-button" onClick={() => void updateInvitation(item.id, "cancelled")}><XCircle size={15} /> Cancel</button>}{item.status === "cancelled" && <button disabled={busy} type="button" className="secondary-button" onClick={() => void updateInvitation(item.id, "pending")}><CheckCircle2 size={15} /> Reopen</button>}</div></div>)}</div>}</section>
    </> : <section className="surface p-5 sm:p-6"><div className="flex items-start gap-3"><Activity className="mt-1 text-[var(--teal)]" size={21} /><div><p className="eyebrow">Operator workspace</p><h2 className="mt-1 text-xl font-black text-[var(--teal-dark)]">Your permitted records</h2><p className="mt-1 text-sm leading-6 text-[var(--muted)]">You can work only with records for {workspace.booth?.name ?? "your assigned booth"}. Owner-only approvals and team controls are not shown.</p></div></div><div className="mt-5 flex flex-wrap gap-2"><Link className="primary-button" href="/new-transaction">Record transaction</Link><Link className="secondary-button" href="/transactions">View transactions</Link><Link className="secondary-button" href="/customers">Customers</Link><Link className="secondary-button" href="/expenses">Expenses</Link><Link className="secondary-button" href="/reconciliation">Reconciliation</Link></div></section>}
    <section className="surface overflow-hidden"><div className="flex items-center justify-between border-b border-[var(--line)] p-5"><div><p className="eyebrow">Recent activity</p><h2 className="mt-1 text-xl font-black text-[var(--teal-dark)]">Operational transactions</h2></div><Link href="/transactions" className="text-sm font-bold text-[var(--teal)]">View all</Link></div>{activity.length === 0 ? <p className="p-7 text-sm text-[var(--muted)]">No transactions are available for this access scope yet.</p> : <div className="divide-y divide-[var(--line)]">{activity.map((row) => <Link key={row.id} href="/transactions" className="flex flex-col justify-between gap-2 p-5 hover:bg-[var(--canvas)] sm:flex-row sm:items-center"><div><p className="font-bold text-[var(--teal-dark)]">#{row.transaction_number} · {typeLabel(row.transaction_type)}</p><p className="mt-1 text-xs text-[var(--muted)]">{networkLabel(row.network)} · {maskPhone(row.customer_phone)} · {new Date(row.transaction_at).toLocaleString("en-GH", { dateStyle: "medium", timeStyle: "short" })}</p></div><div className="sm:text-right"><p className="font-black text-[var(--teal-dark)]">{gh(row.principal_amount_pesewas)}</p><p className="text-xs font-bold text-[var(--muted)]">{row.transaction_status}</p></div></Link>)}</div>}</section>
  </div>;
}
