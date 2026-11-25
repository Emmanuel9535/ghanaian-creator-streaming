import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { Nunito_Sans } from "next/font/google";

const nunitoSans = Nunito_Sans({
  variable: "--font-nunito-sans",
  subsets: ["latin"],
  display: "swap",
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  title: "MoMo Ledger | Mobile Money business control",
  description: "Offline-first transaction recording and business management for Ghanaian MoMo vendors.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={nunitoSans.className}>
        <AppShell>{children}</AppShell>
        <footer className="border-t border-[var(--line)] bg-white px-5 py-6 text-sm text-[var(--muted)] lg:pl-72">
          <div className="mx-auto flex max-w-7xl flex-col justify-between gap-2 px-1 sm:flex-row">
            <p>MoMo Ledger · Built for Ghanaian mobile money vendors</p>
            <p>Stage 1 foundation · Supabase and Vercel ready</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
