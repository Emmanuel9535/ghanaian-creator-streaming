"use client";

import { useEffect, useState } from "react";

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

export function PwaRegister() {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    const onBeforeInstall = (event: Event) => { event.preventDefault(); setPromptEvent(event as InstallPromptEvent); };
    const onInstalled = () => { setInstalled(true); setPromptEvent(null); };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => { window.removeEventListener("beforeinstallprompt", onBeforeInstall); window.removeEventListener("appinstalled", onInstalled); };
  }, []);

  if (!promptEvent || installed) return null;
  return <button type="button" onClick={async () => { await promptEvent.prompt(); await promptEvent.userChoice; setPromptEvent(null); }} className="fixed bottom-4 left-4 right-4 z-50 rounded-2xl bg-[var(--teal-dark)] px-4 py-3 text-left text-sm font-bold text-white shadow-2xl sm:left-auto sm:max-w-sm">Install MoMo Ledger on this phone <span className="ml-2 text-[var(--yellow)]">Install</span></button>;
}
