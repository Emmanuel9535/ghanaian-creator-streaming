"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase";
import { gh, parsePesewas } from "@/lib/transactions";

type Membership = { business_id: string; booth_id: string | null; role: "OWNER" | "ATTENDANT" };
type Booth = { id: string; name: string };
type Account = { id: string; booth_id: string | null; account_code: string; account_category: string; network: string | null; current_balance_pesewas: number; allow_overdraft: boolean };
type Category = { id: string; name: string; is_active: boolean };
type Expense = { id: string; internal_reference: string; business_id: string; booth_id: string; category_id: string; description: string; amount_pesewas: number; expense_at: string; payment_source_account_id: string; payee: string | null; notes: string | null; status: string; recorded_by: string; created_at: string };
type Summary = { today_pesewas: number; week_pesewas: number; month_pesewas: number; pending_count: number; category_totals: { category_id: string; category: string; amount_pesewas: number; expense_count: number }[]; payment_source_totals: { account_id: string; account_code: string; account_category: string; network: string | null; amount_pesewas: number }[] };
const PAGE_SIZE = 20;
const STATUS_LABEL: Record<string, string> = { PENDING_APPROVAL: "Pending approval", APPROVED: "Approved", POSTED: "Posted", REJECTED: "Rejected", REVERSED: "Reversed", DRAFT: "Draft" };
const DEFAULT_CATEGORIES = ["Rent", "Electricity", "Water", "Internet and data", "Staff salaries and wages", "Transportation", "Security", "Office supplies", "Equipment and repairs", "Generator fuel", "Business maintenance", "Bank charges", "Other expenses"];
function localDateTime() { const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset()); return now.toISOString().slice(0, 16); }
function accountLabel(account: Account) { if (account.account_category === "PHYSICAL_CASH") return "Physical cash"; if (account.account_category === "ELECTRONIC_FLOAT") return `${account.network ?? "Network"} float`; return account.account_code.replaceAll("_", " "); }
function badge(status: string) { return status === "POSTED" ? "bg-emerald-50 text-emerald-800" : status === "PENDING_APPROVAL" ? "bg-amber-50 text-amber-800" : status === "REJECTED" || status === "REVERSED" ? "bg-rose-50 text-rose-800" : "bg-slate-100 text-slate-700"; }

export default function ExpensesPage() {
  const supabase = useMemo(() => createClient(), []);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [booths, setBooths] = useState<Booth[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [selectedBooth, setSelectedBooth] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [accountFilter, setAccountFilter] = useState("");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [amount, setAmount] = useState("");
  const [expenseAt, setExpenseAt] = useState(localDateTime());
  const [categoryId, setCategoryId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [description, setDescription] = useState("");
  const [payee, setPayee] = useState("");
  const [notes, setNotes] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const requestIdRef = useRef<string | null>(null);
  const [decision, setDecision] = useState<{ expense: Expense; action: "approve" | "reject" | "reverse" } | null>(null);
  const [history, setHistory] = useState<{ expense: Expense; rows: { from_status: string | null; to_status: string; reason: string | null; changed_by: string; created_at: string }[] } | null>(null);
  const [decisionReason, setDecisionReason] = useState("");

  const loadExpenses = useCallback(async (m: Membership, pageIndex: number, status: string, acct: string) => {
    if (!supabase) return;
    let query = supabase.from("expenses").select("id,internal_reference,business_id,booth_id,category_id,description,amount_pesewas,expense_at,payment_source_account_id,payee,notes,status,recorded_by,created_at").eq("business_id", m.business_id).order("expense_at", { ascending: false }).range(pageIndex * PAGE_SIZE, (pageIndex + 1) * PAGE_SIZE);
    if (status) query = query.eq("status", status);
    if (acct) query = query.eq("payment_source_account_id", acct);
    if (m.role !== "OWNER" && m.booth_id) query = query.eq("booth_id", m.booth_id);
    const { data, error: queryError } = await query;
    if (queryError) { setError(queryError.message); return; }
    const rows = (data ?? []) as Expense[];
    setHasMore(rows.length > PAGE_SIZE);
    setExpenses(rows.slice(0, PAGE_SIZE));
  }, [supabase]);

  const refresh = useCallback(async () => {
    if (!supabase) { setError("Supabase is not configured for this application."); setLoading(false); return; }
    setLoading(true); setError("");
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) { setError("Sign in to access business expenses."); setLoading(false); return; }
    const { data: m, error: membershipError } = await supabase.from("business_members").select("business_id,booth_id,role").eq("user_id", user.id).eq("status", "active").order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (membershipError || !m) { setError(membershipError?.message ?? "No active business membership was found."); setLoading(false); return; }
    const member = m as Membership;
    setMembership(member);
    const [boothResult, accountResult, categoryResult, summaryResult] = await Promise.all([
      supabase.from("booths").select("id,name").eq("business_id", member.business_id).order("name"),
      supabase.from("financial_accounts").select("id,booth_id,account_code,account_category,network,current_balance_pesewas,allow_overdraft").eq("business_id", member.business_id).order("account_category").order("network"),
      supabase.from("expense_categories").select("id,name,is_active").eq("business_id", member.business_id).order("name"),
      supabase.rpc("expense_dashboard_summary", { target_business_id: member.business_id, target_booth_id: member.role === "OWNER" ? null : member.booth_id }),
    ]);
    if (boothResult.error) setError(boothResult.error.message);
    if (accountResult.error) setError(accountResult.error.message);
    if (categoryResult.error) setError(categoryResult.error.message);
    if (summaryResult.error) setError(summaryResult.error.message);
    const activeBooths = (boothResult.data ?? []) as Booth[];
    const allowedAccounts = ((accountResult.data ?? []) as Account[]).filter((a) => a.account_category === "PHYSICAL_CASH" || (a.account_category === "ELECTRONIC_FLOAT" && (member.role === "OWNER" || a.booth_id === member.booth_id)));
    setBooths(activeBooths); setAccounts(allowedAccounts); setCategories((categoryResult.data ?? []) as Category[]); setSummary((summaryResult.data ?? null) as Summary | null);
    setSelectedBooth((previous) => previous || member.booth_id || activeBooths[0]?.id || "");
    setAccountId((previous) => allowedAccounts.some((a) => a.id === previous) ? previous : allowedAccounts[0]?.id ?? "");
    const { data: firstPage, error: listError } = await supabase.from("expenses").select("id,internal_reference,business_id,booth_id,category_id,description,amount_pesewas,expense_at,payment_source_account_id,payee,notes,status,recorded_by,created_at").eq("business_id", member.business_id).order("expense_at", { ascending: false }).range(0, PAGE_SIZE);
    if (listError) setError(listError.message);
    const rows = (firstPage ?? []) as Expense[];
    setExpenses(rows.slice(0, PAGE_SIZE)); setHasMore(rows.length > PAGE_SIZE); setPage(0); setLoading(false);
  }, [supabase]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!membership) return;
    setLoading(true);
    void loadExpenses(membership, page, statusFilter, accountFilter).finally(() => setLoading(false));
  }, [membership, page, statusFilter, accountFilter, loadExpenses]);

  async function submitExpense(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !membership) return;
    const amountPesewas = parsePesewas(amount);
    if (!amountPesewas) { setError("Enter an amount greater than GH₵0.00 with no more than two decimal places."); return; }
    if (!selectedBooth || !categoryId || !accountId) { setError("Choose a booth, category, and available payment source."); return; }
    const account = accounts.find((a) => a.id === accountId);
    if (!account) { setError("That payment source is no longer available."); return; }
    if (amountPesewas > Number(account.current_balance_pesewas) && !account.allow_overdraft) { setError("The selected account does not have enough available balance. Choose another account or reduce the amount."); return; }
    setBusy(true); setError(""); setNotice("");
    const requestId = requestIdRef.current ?? crypto.randomUUID();
    requestIdRef.current = requestId;
    const { data, error: rpcError } = await supabase.rpc("record_expense", {
      target_business_id: membership.business_id,
      target_booth_id: selectedBooth,
      target_category_id: categoryId,
      expense_description: description.trim(),
      amount_pesewas: amountPesewas,
      expense_at_value: new Date(expenseAt).toISOString(),
      payment_source_account_id: accountId,
      payee_value: payee.trim() || null,
      notes_value: notes.trim() || null,
      request_id: requestId,
    });
    setBusy(false);
    if (rpcError) { setError(rpcError.message); return; }
    requestIdRef.current = null;
    const outcome = (data as { status?: string } | null)?.status;
    setNotice(outcome === "pending_approval" ? "Expense submitted for owner approval. No balance changed." : outcome === "already_posted" ? "This expense was already posted; the balance was not changed again." : "Expense recorded and posted to the selected financial account.");
    setDescription(""); setAmount(""); setPayee(""); setNotes(""); setExpenseAt(localDateTime()); setPage(0);
    await refresh(); await loadExpenses(membership, 0, statusFilter, accountFilter);
  }

  async function decideExpense(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !decision || !membership) return;
    if (decision.action !== "approve" && decisionReason.trim().length < 5) { setError(decision.action === "reverse" ? "Enter a reversal reason of at least five characters." : "Enter a rejection reason of at least five characters."); return; }
    setBusy(true); setError("");
    const result = decision.action === "approve"
      ? await supabase.rpc("approve_expense", { target_expense_id: decision.expense.id, approval_note: decisionReason.trim() || null })
      : decision.action === "reject"
        ? await supabase.rpc("reject_expense", { target_expense_id: decision.expense.id, rejection_reason: decisionReason.trim() })
        : await supabase.rpc("reverse_expense", { target_expense_id: decision.expense.id, reversal_reason: decisionReason.trim(), request_id: crypto.randomUUID() });
    setBusy(false);
    if (result.error) { setError(result.error.message); return; }
    setNotice(decision.action === "approve" ? "Expense approved and posted once to its selected account." : decision.action === "reject" ? "Expense rejected. No financial balance was changed." : "Expense reversal posted to the ledger and recorded in the audit history.");
    setDecision(null); setDecisionReason(""); await refresh(); await loadExpenses(membership, 0, statusFilter, accountFilter);
  }

  async function addCategory(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !membership) return;
    const name = newCategory.trim();
    if (!name || name.length > 80) { setError("Enter a category name up to 80 characters."); return; }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError("Sign in to manage categories."); return; }
    setBusy(true); setError("");
    const { error: insertError } = await supabase.from("expense_categories").insert({ business_id: membership.business_id, name, created_by: user.id }).select("id").single();
    setBusy(false);
    if (insertError) { setError(insertError.code === "23505" ? "That category already exists." : insertError.message); return; }
    setNewCategory(""); await refresh(); setNotice("Custom category added. Existing expense records remain unchanged.");
  }

  async function deactivateCategory(category: Category) {
    if (!supabase || !membership || !window.confirm(`Hide “${category.name}” from new expenses? Existing records keep the category.`)) return;
    setBusy(true); setError("");
    const { error: updateError } = await supabase.from("expense_categories").update({ is_active: false }).eq("id", category.id).eq("business_id", membership.business_id);
    setBusy(false);
    if (updateError) { setError(updateError.message); return; }
    await refresh(); setNotice("Category hidden from new entries; history retained.");
  }

  async function changePage(next: number) {
    if (!membership) return;
    setPage(next); setLoading(true);
    await loadExpenses(membership, next, statusFilter, accountFilter); setLoading(false);
  }

  async function showHistory(expense: Expense) {
    if (!supabase) return;
    setError("");
    const { data, error: historyError } = await supabase.from("expense_status_history").select("from_status,to_status,reason,changed_by,created_at").eq("expense_id", expense.id).order("created_at", { ascending: true });
    if (historyError) { setError(historyError.message); return; }
    setHistory({ expense, rows: data ?? [] });
  }

  const isOwner = membership?.role === "OWNER";
  const categoriesById = new Map(categories.map((item) => [item.id, item.name]));
  const activeCategories = categories.filter((item) => item.is_active);
  const accountsById = new Map(accounts.map((item) => [item.id, item]));
  const visibleAccounts = accounts.filter((a) => a.account_category === "PHYSICAL_CASH" || a.booth_id === selectedBooth);

  return <div className="space-y-7">
    <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="eyebrow">Operating costs</p><h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Expenses</h1><p className="mt-2 max-w-2xl text-sm text-slate-600">Record day-to-day business costs against one configured financial account. Posted expenses are immutable; corrections use an auditable reversal.</p></div><a href="/cashbook" className="secondary-button">View cashbook</a></header>
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
    {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</div>}
    {summary && isOwner && <section aria-label="Expense overview" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[["Today", summary.today_pesewas], ["This week", summary.week_pesewas], ["This month", summary.month_pesewas]].map(([label, value]) => <article key={String(label)} className="surface p-4"><p className="text-sm font-semibold text-slate-600">{label} · posted expenses</p><p className="mt-2 text-2xl font-black text-slate-950">{gh(Number(value))}</p></article>)}
      <article className="surface border-amber-200 p-4"><p className="text-sm font-semibold text-slate-600">Awaiting approval</p><p className="mt-2 text-2xl font-black text-amber-800">{summary.pending_count}</p></article>
    </section>}
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(340px,0.8fr)]">
      <section className="surface p-5 sm:p-6"><div className="mb-5"><p className="eyebrow">New record</p><h2 className="mt-2 text-xl font-black text-slate-950">Record an expense</h2><p className="mt-1 text-sm text-slate-500">Attendant submissions remain pending until an owner approves them.</p></div>
        <form onSubmit={submitExpense} onChange={() => { requestIdRef.current = null; }} className="grid gap-4 sm:grid-cols-2">
          <label className="field sm:col-span-2"><span>Description</span><input required maxLength={180} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. March booth rent" /></label>
          <label className="field"><span>Category</span><select required value={categoryId} onChange={(e) => setCategoryId(e.target.value)}><option value="">Select category</option>{activeCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label className="field"><span>Amount (GH₵)</span><input required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></label>
          <label className="field"><span>Date and time</span><input required type="datetime-local" value={expenseAt} onChange={(e) => setExpenseAt(e.target.value)} /></label>
          {isOwner && <label className="field"><span>Booth or location</span><select required value={selectedBooth} onChange={(e) => { setSelectedBooth(e.target.value); setAccountId(""); }}><option value="">Select booth</option>{booths.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
          <label className="field"><span>Payment source</span><select required value={accountId} onChange={(e) => setAccountId(e.target.value)}><option value="">Select source</option>{visibleAccounts.map((a) => <option key={a.id} value={a.id}>{accountLabel(a)} · available {gh(a.current_balance_pesewas)}</option>)}</select></label>
          <label className="field"><span>Payee <em>optional</em></span><input maxLength={120} value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="Recipient or supplier" /></label>
          <label className="field sm:col-span-2"><span>Notes <em>optional</em></span><textarea rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add context for the owner or future review" /></label>
          <div className="sm:col-span-2 rounded-xl bg-sky-50 p-3 text-xs leading-5 text-slate-600">Receipt uploads are not enabled: private business-scoped storage policies have not been verified for this project. Do not paste public receipt URLs here.</div>
          <div className="sm:col-span-2"><button className="primary-button w-full sm:w-auto" disabled={busy || !activeCategories.length || !accounts.length}>{busy ? "Saving…" : isOwner ? "Record and post expense" : "Submit for owner approval"}</button>{(!activeCategories.length || !accounts.length) && <p className="mt-2 text-xs text-amber-800">An active expense category and configured payment account are required before recording.</p>}</div>
        </form>
      </section>
      <section className="space-y-5">
        {isOwner && <article className="surface p-5"><p className="eyebrow">Category settings</p><h2 className="mt-2 text-lg font-black text-slate-950">Custom categories</h2><form onSubmit={addCategory} className="mt-4 flex gap-2"><input aria-label="New category name" className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-200 px-3 text-sm" maxLength={80} value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="e.g. Market levy" /><button className="secondary-button" disabled={busy}>Add</button></form><div className="mt-3 flex flex-wrap gap-2">{activeCategories.map((c) => <span key={c.id} className="inline-flex items-center gap-2 rounded-full bg-slate-100 py-1 pl-3 pr-1 text-xs font-semibold text-slate-700">{c.name}<button aria-label={`Hide ${c.name}`} className="grid h-6 w-6 place-items-center rounded-full text-slate-500 hover:bg-white" onClick={() => void deactivateCategory(c)}>×</button></span>)}</div>{!activeCategories.length && <p className="mt-3 text-sm text-slate-500">No active categories yet. Standard categories can be initialized for this business.</p>}</article>}
        {summary && isOwner && <article className="surface p-5"><p className="eyebrow">This month</p><h2 className="mt-2 text-lg font-black text-slate-950">Where expenses go</h2>{summary.category_totals.length ? <div className="mt-3 space-y-3">{summary.category_totals.map((row) => <div key={row.category_id}><div className="flex justify-between gap-3 text-sm"><span className="font-semibold text-slate-700">{row.category}</span><span className="font-bold text-slate-950">{gh(row.amount_pesewas)}</span></div><div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-sky-400" style={{ width: `${Math.max(3, Math.round(Number(row.amount_pesewas) / Math.max(1, ...summary.category_totals.map((x) => Number(x.amount_pesewas))) * 100))}%` }} /></div></div>)}</div> : <p className="mt-3 text-sm text-slate-500">No posted expenses yet this month.</p>}<div className="mt-5 border-t border-slate-100 pt-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">By payment source</p>{summary.payment_source_totals.length ? <div className="mt-3 space-y-2">{summary.payment_source_totals.map((row) => <div key={row.account_id} className="flex justify-between gap-3 text-sm"><span className="text-slate-600">{row.account_category === "PHYSICAL_CASH" ? "Physical cash" : `${row.network ?? row.account_code} float`}</span><span className="font-bold text-slate-900">{gh(row.amount_pesewas)}</span></div>)}</div> : <p className="mt-2 text-sm text-slate-500">No expense payments recorded this month.</p>}</div></article>}
      </section>
    </div>
    {history && <div className="fixed inset-0 z-30 grid place-items-center bg-slate-950/30 p-4"><section role="dialog" aria-modal="true" aria-label="Expense audit history" className="surface w-full max-w-lg p-5"><div className="flex items-start justify-between gap-3"><div><p className="eyebrow">Audit trail</p><h2 className="mt-2 text-lg font-black text-slate-950">{history.expense.internal_reference}</h2><p className="mt-1 text-sm text-slate-600">{history.expense.description}</p></div><button className="secondary-button" onClick={() => setHistory(null)}>Close</button></div><ol className="mt-5 space-y-4">{history.rows.map((item, index) => <li key={`${item.created_at}-${index}`} className="border-l-2 border-sky-200 pl-4"><p className="font-bold text-slate-900">{item.from_status ? `${STATUS_LABEL[item.from_status] ?? item.from_status} → ` : ""}{STATUS_LABEL[item.to_status] ?? item.to_status}</p><p className="mt-1 text-xs text-slate-500">{new Date(item.created_at).toLocaleString("en-GH", { dateStyle: "medium", timeStyle: "short" })} · {item.changed_by.slice(0, 8)}</p>{item.reason && <p className="mt-1 text-sm text-slate-600">{item.reason}</p>}</li>)}</ol>{!history.rows.length && <p className="mt-5 text-sm text-slate-500">No status changes were found.</p>}</section></div>}{decision && <div className="fixed inset-0 z-30 grid place-items-center bg-slate-950/30 p-4"><form onSubmit={decideExpense} className="surface w-full max-w-md p-5"><h2 className="text-lg font-black text-slate-950">{decision.action === "approve" ? "Approve and post" : decision.action === "reject" ? "Reject expense" : "Reverse posted expense"}</h2><p className="mt-2 text-sm text-slate-600">{decision.expense.internal_reference} · {gh(decision.expense.amount_pesewas)}. {decision.action === "approve" ? "This will post exactly once to its selected account." : decision.action === "reject" ? "Rejected expenses do not change balances." : "The correction is posted as a separate, auditable ledger movement."}</p><label className="field mt-4"><span>{decision.action === "approve" ? "Approval note (optional)" : decision.action === "reject" ? "Reason for rejection" : "Reason for reversal"}</span><textarea rows={3} value={decisionReason} onChange={(e) => setDecisionReason(e.target.value)} /></label><div className="mt-4 flex justify-end gap-2"><button type="button" className="secondary-button" onClick={() => setDecision(null)}>Cancel</button><button className={decision.action === "approve" ? "primary-button" : "rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white"} disabled={busy}>{busy ? "Saving…" : decision.action === "approve" ? "Approve expense" : decision.action === "reject" ? "Reject expense" : "Post reversal"}</button></div></form></div>}
    <section className="surface overflow-hidden"><div className="flex flex-col justify-between gap-4 border-b border-slate-200 p-5 sm:flex-row sm:items-end"><div><p className="eyebrow">Expense history</p><h2 className="mt-2 text-xl font-black text-slate-950">Recent expenses</h2></div><div className="grid gap-2 sm:grid-cols-2"><label className="field"><span className="sr-only">Filter by status</span><select aria-label="Filter by status" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}><option value="">All statuses</option>{["PENDING_APPROVAL", "POSTED", "REJECTED", "REVERSED"].map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></label><label className="field"><span className="sr-only">Filter by payment source</span><select aria-label="Filter by payment source" value={accountFilter} onChange={(e) => { setAccountFilter(e.target.value); setPage(0); }}><option value="">All payment sources</option>{accounts.map((a) => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}</select></label></div></div>
      {loading ? <p className="p-8 text-sm text-slate-500">Loading expense history…</p> : expenses.length === 0 ? <div className="p-10 text-center"><h3 className="font-bold text-slate-900">No expenses match these filters</h3><p className="mt-1 text-sm text-slate-500">New records will appear here with their approval or posting status.</p></div> : <div className="divide-y divide-slate-100">{expenses.map((row) => { const account = accountsById.get(row.payment_source_account_id); const boothName = booths.find((b) => b.id === row.booth_id)?.name; return <article key={row.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-bold text-slate-900">{row.description}</h3><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${badge(row.status)}`}>{STATUS_LABEL[row.status] ?? row.status}</span></div><p className="mt-1 text-xs text-slate-500">{row.internal_reference} · {categoriesById.get(row.category_id) ?? "Archived category"}{boothName ? ` · ${boothName}` : ""} · {account ? accountLabel(account) : "Configured account"}</p><p className="mt-1 text-xs text-slate-500">{new Date(row.expense_at).toLocaleString("en-GH", { dateStyle: "medium", timeStyle: "short" })}{row.payee ? ` · Payee: ${row.payee}` : ""} · Recorded by {row.recorded_by.slice(0, 8)}</p>{row.notes && <p className="mt-1 text-sm text-slate-600">{row.notes}</p>}</div><div className="flex flex-wrap items-center justify-end gap-2"><button className="secondary-button" onClick={() => void showHistory(row)}>History</button>{isOwner && row.status === "PENDING_APPROVAL" && <><button className="secondary-button" onClick={() => { setDecision({ expense: row, action: "reject" }); setDecisionReason(""); }}>Reject</button><button className="primary-button" onClick={() => { setDecision({ expense: row, action: "approve" }); setDecisionReason(""); }}>Review</button></>}{isOwner && row.status === "POSTED" && <button className="secondary-button" onClick={() => { setDecision({ expense: row, action: "reverse" }); setDecisionReason(""); }}>Reverse</button>}<strong className="whitespace-nowrap text-lg font-black text-slate-950">{gh(row.amount_pesewas)}</strong></div></article>; })}</div>}
      <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3"><p className="text-xs text-slate-500">Page {page + 1} · financial history is loaded in pages</p><div className="flex gap-2"><button className="secondary-button" disabled={page === 0 || loading} onClick={() => void changePage(page - 1)}>Previous</button><button className="secondary-button" disabled={!hasMore || loading} onClick={() => void changePage(page + 1)}>Next</button></div></div>
    </section>
    {isOwner && <p className="text-xs text-slate-500">Standard categories include {DEFAULT_CATEGORIES.slice(0, 3).join(", ")} and other operating costs. Financial amounts are recorded in pesewas; pending and rejected expenses never affect account balances.</p>}
  </div>;
}
