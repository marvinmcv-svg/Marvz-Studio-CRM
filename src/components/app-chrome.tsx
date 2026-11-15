"use client";

import clsx from "clsx";
import { Download, Monitor, Moon, Share, Sun, X } from "lucide-react";
import { useEffect, useState } from "react";

type Theme = "system" | "light" | "dark";
const THEME_KEY = "squad-theme";

/** Inline script for <head>: applies the saved appearance before first paint (no flash). */
export const themeBootScript = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

function applyTheme(t: Theme) {
  const el = document.documentElement;
  if (t === "system") delete el.dataset.theme;
  else el.dataset.theme = t;
  try { localStorage.setItem(THEME_KEY, t); } catch { /* private mode */ }
  // keep the status-bar / title-bar colour in step
  const dark = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", dark ? "#000000" : "#f2f2f7"));
}

/** Apple-style segmented control: System · Light · Dark. */
export function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(() => {
    try {
      const t = localStorage.getItem(THEME_KEY);
      if (t === "light" || t === "dark") setTheme(t);
    } catch { /* ignore */ }
  }, []);
  const opts: { v: Theme; icon: React.ReactNode; label: string }[] = [
    { v: "system", icon: <Monitor size={13} />, label: "Automatic" },
    { v: "light", icon: <Sun size={13} />, label: "Light" },
    { v: "dark", icon: <Moon size={13} />, label: "Dark" },
  ];
  return (
    <div className="segmented w-full" role="radiogroup" aria-label="Appearance">
      {opts.map((o) => (
        <button key={o.v} role="radio" aria-checked={theme === o.v} aria-label={o.label} title={o.label}
          data-active={theme === o.v} className="segment h-7 flex-1 justify-center px-2"
          onClick={() => { setTheme(o.v); applyTheme(o.v); }}>
          {o.icon}
        </button>
      ))}
    </div>
  );
}

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/** Registers the service worker and offers "Install app" (Chrome/Edge/Android) or iPhone instructions. */
export function InstallApp({ compact = false }: { compact?: boolean }) {
  const [prompt, setPrompt] = useState<BIPEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [installed, setInstalled] = useState(true);
  const [showIosHelp, setShowIosHelp] = useState(false);

  useEffect(() => {
    const secure = location.protocol === "https:" || location.hostname === "localhost";
    if ("serviceWorker" in navigator && secure) {
      navigator.serviceWorker.register("/sw.js").catch(() => { /* offline support is optional */ });
    }
    const standalone = matchMedia("(display-mode: standalone)").matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    setInstalled(standalone);
    const ua = navigator.userAgent;
    setIos(/iPhone|iPad|iPod/.test(ua) || (ua.includes("Mac") && "ontouchend" in document));
    const onPrompt = (e: Event) => { e.preventDefault(); setPrompt(e as BIPEvent); };
    const onInstalled = () => { setInstalled(true); setPrompt(null); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed || (!prompt && !ios)) return null;

  const onClick = async () => {
    if (prompt) {
      await prompt.prompt();
      await prompt.userChoice.catch(() => null);
      setPrompt(null);
    } else {
      setShowIosHelp(true);
    }
  };

  return (
    <>
      <button onClick={onClick} className={clsx(compact ? "btn-ghost" : "btn w-full")} aria-label="Install app">
        <Download size={15} /> {!compact && "Install app"}
      </button>
      {showIosHelp && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-3 sm:items-center" onClick={() => setShowIosHelp(false)}>
          <div className="float w-full max-w-[380px] rounded-[22px] p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div className="text-[17px] font-semibold">Install Squad CRM</div>
              <button className="btn-ghost -mr-2 -mt-1 h-8 w-8 px-0" onClick={() => setShowIosHelp(false)} aria-label="Close"><X size={16} /></button>
            </div>
            <ol className="mt-3 space-y-2.5 text-[14px] text-ink-2">
              <li className="flex items-center gap-2"><span className="kbd">1</span> Tap <Share size={15} className="text-accent" /> <b className="text-ink">Share</b> in Safari&apos;s toolbar</li>
              <li className="flex items-center gap-2"><span className="kbd">2</span> Choose <b className="text-ink">Add to Home Screen</b></li>
              <li className="flex items-center gap-2"><span className="kbd">3</span> Tap <b className="text-ink">Add</b></li>
            </ol>
            <p className="mt-3 text-[12px] text-ink-3">It opens full-screen like an app, with its own icon.</p>
          </div>
        </div>
      )}
    </>
  );
}
