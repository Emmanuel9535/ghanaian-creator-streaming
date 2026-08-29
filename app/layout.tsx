import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ghana First | Creator Streaming Network",
  description: "A creator-first home for Ghanaian film, stories, and independent voices.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header className="border-b border-ink/10 bg-sand/90 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
            <a href="/" className="text-lg font-black tracking-tight">GHANA<span className="text-coral">FIRST</span></a>
            <nav aria-label="Primary navigation" className="hidden gap-7 text-sm font-semibold md:flex">
              <a href="#discover" className="hover:text-coral">Discover</a>
              <a href="#creators" className="hover:text-coral">For creators</a>
              <a href="#about" className="hover:text-coral">About</a>
              <a href="/creator" className="hover:text-coral">Creator studio</a>
            </nav>
            <div className="flex items-center gap-3"><a href="/auth" className="hidden text-sm font-bold text-ink/70 hover:text-coral sm:inline">Log in</a><a href="#join" className="rounded-full bg-ink px-4 py-2 text-sm font-bold text-white hover:bg-coral">Join the network</a></div>
          </div>
        </header>
        <main>{children}</main>
        <footer id="about" className="border-t border-ink/10 px-5 py-8 text-sm text-ink/65">
          <div className="mx-auto flex max-w-6xl flex-col justify-between gap-3 md:flex-row">
            <p>Built for Ghanaian stories, creators, and audiences everywhere.</p>
            <p>Stage 1 foundation · Vercel + Supabase ready</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
