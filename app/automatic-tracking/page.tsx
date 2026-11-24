import Link from "next/link";

const providers = [
  ["MTN MoMo", "Notification evidence can be captured after the user explicitly selects the provider app. Official MTN APIs require provider onboarding and are not a general agent-SMS feed."],
  ["Telecel Cash", "Notification evidence can be captured after explicit selection. Public official material inspected did not document a public agent statement API."],
  ["AT Money", "Notification evidence can be captured after explicit selection. Official terms mention confirmation SMS and mini statements, but no public agent API was documented."],
];

export default function AutomaticTrackingPage() {
  return <div className="space-y-8">
    <div><p className="eyebrow">Automatic tracking</p><h1 className="page-title">Capture evidence. Confirm safely.</h1><p className="page-subtitle">The Android companion can collect selected provider notifications offline. MoMo Ledger keeps each alert review-required until an authenticated operator confirms it.</p></div>
    <div className="grid gap-4 md:grid-cols-3">{providers.map(([name, text]) => <section key={name} className="card"><h2 className="font-black">{name}</h2><p className="mt-3 text-sm leading-6 text-[var(--muted)]">{text}</p><span className="mt-4 inline-flex rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800">Review required</span></section>)}</div>
    <section className="card"><h2 className="font-black">What is protected</h2><div className="mt-4 grid gap-3 text-sm text-[var(--muted)] md:grid-cols-2"><p>• No browser SMS access is used.</p><p>• No SMS or call-log permission is requested by the companion.</p><p>• Offline events retain a device event key for replay deduplication.</p><p>• Failed, pending, ambiguous, and reversed evidence cannot become successful automatically.</p><p>• Only user-selected provider notification packages are monitored.</p><p>• Financial calculations remain downstream of confirmed ledger transactions.</p></div></section>
    <section className="rounded-2xl border border-[var(--line)] bg-[var(--teal-dark)] p-6 text-white"><h2 className="font-black">Finish setup on Android</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-white/70">Install the companion from a signed, reviewed build, grant Android notification access only after reading the consent screen, select the provider packages, and configure the authenticated workspace. Provider API access still requires separate commercial onboarding.</p><Link href="/settings" className="secondary-button mt-5 inline-flex">Open settings</Link></section>
  </div>;
}
