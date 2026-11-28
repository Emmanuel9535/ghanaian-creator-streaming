"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Users, ShieldAlert, UserCheck, Mail, Phone } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { resolveActiveWorkspace, type ActiveWorkspace } from "@/lib/workspace";

type Member = { id: string; user_id: string; booth_id: string | null; role: "OWNER" | "ATTENDANT"; status: string; created_at: string };
type Booth = { id: string; name: string; location: string; status: string };
type Invitation = { id: string; booth_id: string | null; email: string; full_name: string; phone: string; status: string; accepted_by: string | null; expires_at: string; created_at: string };

const statusClass = (status: string) => status === "active" || status === "accepted" ? "bg-emerald-50 text-emerald-700" : status === "suspended" || status === "cancelled" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700";

export default function AttendantsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [workspace, setWorkspace] = useState<ActiveWorkspace | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [booths, setBooths] = useState<Booth[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!supabase) {
      setError("Supabase is not configured for this application.");
      setLoading(false);
      return;
    }
    setRefreshing(true);
    setError("");
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      setError(userError?.message ?? "Sign in to view attendants.");
      setLoading(false);
      setRefreshing(false);
      return;
    }
    const resolution = await resolveActiveWorkspace(supabase, userData.user.id);
    if (resolution.error || !resolution.workspace) {
      setError(resolution.error ?? "No active business workspace was found.");
      setLoading(false);
      setRefreshing(false);
      return;
    }
    const current = resolution.workspace;
    setWorkspace(current);
    const [membersResult, boothsResult, invitationsResult] = await Promise.all([
      supabase.from("business_members").select("id,user_id,booth_id,role,status,created_at").eq("business_id", current.business.id).order("created_at", { ascending: true }),
      supabase.from("booths").select("id,name,location,status").eq("business_id", current.business.id).order("name"),
      current.role === "OWNER" ? supabase.from("invitations").select("id,booth_id,email,full_name,phone,status,accepted_by,expires_at,created_at").eq("business_id", current.business.id).order("created_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
    ]);
    const firstError = membersResult.error ?? boothsResult.error ?? invitationsResult.error;
    if (firstError) setError(firstError.message);
    setMembers((membersResult.data ?? []) as Member[]);
    setBooths((boothsResult.data ?? []) as Booth[]);
    setInvitations((invitationsResult.data ?? []) as Invitation[]);
    setLoading(false);
    setRefreshing(false);
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);

  const boothById = new Map(booths.map((booth) => [booth.id, booth]));
  const invitationByAcceptedUser = new Map(invitations.filter((row) => row.accepted_by).map((row) => [row.accepted_by as string, row]));
  const attendants = members.filter((member) => member.role === "ATTENDANT");
  const activeCount = members.filter((member) => member.status === "active").length;
  const pendingCount = invitations.filter((row) => row.status === "pending").length;

  if (loading) return <div className="surface p-6 text-sm text-[var(--muted)]">Loading attendant details…</div>;

  return <div className="space-y-7">
    <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="eyebrow">Team access</p><h1 className="mt-2 text-3xl font-black tracking-tight text-[var(--teal-dark)]">Attendants</h1><p className="mt-2 text-sm leading-6 text-[var(--muted)]">Review who can operate {workspace?.business.name ?? "your business"}, where they are assigned and the status of their invitation.</p></div><button onClick={() => void load()} disabled={refreshing} className="secondary-button w-fit"><RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />{refreshing ? "Refreshing…" : "Refresh details"}</button></section>
    {error && <div role="alert" className="flex gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><ShieldAlert size={18} className="mt-0.5 shrink-0" /><span>{error}</span></div>}
    {workspace?.role !== "OWNER" && <div className="rounded-2xl border border-[#f1d97a] bg-[#fff9df] p-4 text-sm text-[#6f5700]">Attendant access is owner-managed. You can see your assigned workspace details, but only the business owner can manage team access.</div>}
    <section className="grid gap-4 sm:grid-cols-3"><div className="surface p-5"><div className="flex items-center justify-between"><p className="text-sm font-semibold text-[var(--muted)]">Active team members</p><Users size={20} className="text-[var(--teal)]" /></div><p className="mt-3 text-2xl font-black text-[var(--teal-dark)]">{activeCount}</p></div><div className="surface p-5"><p className="text-sm font-semibold text-[var(--muted)]">Active attendants</p><p className="mt-3 text-2xl font-black text-[var(--teal-dark)]">{attendants.filter((member) => member.status === "active").length}</p><p className="mt-1 text-xs text-[var(--muted)]">Assigned operational users</p></div><div className="surface p-5"><p className="text-sm font-semibold text-[var(--muted)]">Pending invitations</p><p className="mt-3 text-2xl font-black text-amber-700">{pendingCount}</p><p className="mt-1 text-xs text-[var(--muted)]">Awaiting acceptance</p></div></section>
    <section className="surface overflow-hidden"><div className="border-b border-[var(--line)] px-5 py-5 sm:px-6"><p className="eyebrow">Access directory</p><h2 className="mt-1 text-xl font-black text-[var(--teal-dark)]">Current business members</h2></div>{members.length === 0 ? <div className="p-10 text-center text-sm text-[var(--muted)]">No active business members were found.</div> : <div className="divide-y divide-[#edf0f1]">{members.map((member) => { const invitation = invitationByAcceptedUser.get(member.user_id); const booth = member.booth_id ? boothById.get(member.booth_id) : null; return <article key={member.id} className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6"><div className="flex min-w-0 items-start gap-3"><span className={`grid h-10 w-10 shrink-0 place-items-center rounded-2xl ${member.role === "OWNER" ? "bg-[#fff7d6] text-[#876b00]" : "bg-[#e8f4f7] text-[var(--teal)]"}`}>{member.role === "OWNER" ? <UserCheck size={19} /> : <Users size={19} />}</span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-bold text-[var(--teal-dark)]">{invitation?.full_name ?? (member.role === "OWNER" ? "Business owner" : "Attendant")}</h3><span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${statusClass(member.status)}`}>{member.status}</span><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-slate-600">{member.role}</span></div><p className="mt-1 text-xs text-[var(--muted)]">User ID: {member.user_id.slice(0, 8)}… · Joined {new Date(member.created_at).toLocaleDateString("en-GH", { dateStyle: "medium" })}</p><p className="mt-1 text-sm text-[var(--muted)]">{booth ? `${booth.name} · ${booth.location}` : member.role === "OWNER" ? "Business-wide owner access" : "No booth assigned"}</p></div></div><div className="space-y-1 text-left text-sm sm:text-right">{invitation?.email && <p className="flex items-center gap-2 text-[var(--muted)] sm:justify-end"><Mail size={14} />{invitation.email}</p>}{invitation?.phone && <p className="flex items-center gap-2 text-[var(--muted)] sm:justify-end"><Phone size={14} />{invitation.phone}</p>}<p className="text-xs text-[var(--muted)]">Access follows current Supabase role and booth permissions.</p></div></article>; })}</div>}</section>
    {workspace?.role === "OWNER" && <section className="surface overflow-hidden"><div className="border-b border-[var(--line)] px-5 py-5 sm:px-6"><p className="eyebrow">Invitation history</p><h2 className="mt-1 text-xl font-black text-[var(--teal-dark)]">Pending and past invitations</h2></div>{invitations.length === 0 ? <div className="p-10 text-center text-sm text-[var(--muted)]">No attendant invitations have been saved yet. Use Settings to invite an attendant.</div> : <div className="overflow-x-auto"><table className="data-table"><thead><tr><th>Name</th><th>Contact</th><th>Booth</th><th>Status</th><th>Expires</th></tr></thead><tbody>{invitations.map((invitation) => <tr key={invitation.id}><td className="font-bold">{invitation.full_name}</td><td><div>{invitation.email}</div><div className="text-xs text-[var(--muted)]">{invitation.phone}</div></td><td>{invitation.booth_id ? boothById.get(invitation.booth_id)?.name ?? "Assigned booth" : "Business-wide"}</td><td><span className={`rounded-full px-2.5 py-1 text-xs font-bold capitalize ${statusClass(invitation.status)}`}>{invitation.status}</span></td><td className="whitespace-nowrap">{new Date(invitation.expires_at).toLocaleDateString("en-GH", { dateStyle: "medium" })}</td></tr>)}</tbody></table></div>}</section>}
  </div>;
}
