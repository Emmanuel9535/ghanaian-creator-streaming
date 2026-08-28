const signals = [
  ["01", "Local stories", "Films rooted in the places, languages, and lived experience of Ghana."],
  ["02", "Creator-first", "A fairer path from independent idea to a watching audience."],
  ["03", "Global reach", "A home for Ghanaian voices wherever the audience lives."],
];

export default function HomePage() {
  return (
    <>
      <section className="mx-auto grid max-w-6xl gap-12 px-5 pb-24 pt-16 md:grid-cols-[1.1fr_.9fr] md:items-end md:pt-28">
        <div>
          <p className="mb-5 text-sm font-black uppercase tracking-[.24em] text-coral">Ghanaian creator streaming network</p>
          <h1 className="max-w-3xl text-5xl font-black leading-[.95] tracking-[-.05em] md:text-8xl">Stories from home, <span className="text-coral">made for everywhere.</span></h1>
          <p className="mt-7 max-w-xl text-lg leading-8 text-ink/70">Discover independent films, bold new voices, and the next wave of Ghanaian cinema in one place.</p>
          <div className="mt-9 flex flex-wrap gap-3" id="join">
            <a href="#discover" className="rounded-full bg-coral px-6 py-3 font-bold text-white hover:bg-ink">Explore the vision</a>
            <a href="#creators" className="rounded-full border border-ink/20 px-6 py-3 font-bold hover:border-coral hover:text-coral">I am a creator</a>
          </div>
        </div>
        <div className="relative min-h-[360px] overflow-hidden rounded-[2rem] bg-ink p-8 text-white shadow-2xl shadow-ink/15">
          <div className="absolute -right-14 -top-14 h-52 w-52 rounded-full bg-gold" />
          <div className="absolute -bottom-20 -left-10 h-48 w-48 rounded-full border-[28px] border-coral/80" />
          <div className="relative flex h-full flex-col justify-between">
            <span className="text-6xl font-black text-gold">GH</span>
            <div><p className="text-sm uppercase tracking-[.2em] text-white/60">Coming into focus</p><p className="mt-2 text-3xl font-black leading-tight">A new screen for African cinema.</p></div>
          </div>
        </div>
      </section>

      <section id="discover" className="border-y border-ink/10 bg-white/45">
        <div className="mx-auto grid max-w-6xl gap-0 px-5 md:grid-cols-3">
          {signals.map(([number, title, text]) => <article key={number} className="border-ink/10 py-9 md:border-r md:px-8 md:first:pl-0 md:last:border-r-0"><p className="text-sm font-black text-coral">{number}</p><h2 className="mt-4 text-2xl font-black">{title}</h2><p className="mt-3 leading-7 text-ink/65">{text}</p></article>)}
        </div>
      </section>

      <section id="creators" className="mx-auto max-w-6xl px-5 py-24">
        <div className="grid gap-10 md:grid-cols-[.7fr_1.3fr] md:items-start"><p className="text-sm font-black uppercase tracking-[.2em] text-coral">The first chapter</p><div><h2 className="max-w-3xl text-4xl font-black leading-tight md:text-6xl">Not just another catalogue. <span className="text-coral">A creative economy in motion.</span></h2><p className="mt-6 max-w-2xl text-lg leading-8 text-ink/65">The foundation is ready for the next stages: secure accounts, a searchable film catalogue, creator submissions, rights management, and eventually Mux playback and Paystack test payments.</p></div></div>
      </section>
    </>
  );
}
