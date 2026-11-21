import { redirect } from "next/navigation";
import { isLive } from "@/lib/supabase/env";
import { getAuthState } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";

export const metadata = { title: "Sign in" };

async function signIn(formData: FormData) {
  "use server";
  const sb = await supabaseServer();
  const { error } = await sb.auth.signInWithPassword({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  });
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`);
  redirect("/");
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; reason?: string }> }) {
  if (!isLive) redirect("/");
  const { error } = await searchParams;
  const state = await getAuthState();
  if (state === "member") redirect("/");
  if (state === "not_linked") {
    return (
      <div className="flex min-h-dvh items-center justify-center px-4">
        <div className="float w-full max-w-[400px] rounded-[14px] p-6">
          <div className="font-semibold">This account has no access to Squad CRM</div>
          <p className="mt-2 text-[13px] text-ink-2">
            You are signed in, but your account is not linked to an active squad member, or its access was revoked.
            Ask Letty to link it (<code className="text-ink">npm run setup-agents</code>, see README), then sign in again.
          </p>
          <form action="/auth/signout" method="post" className="mt-5">
            <button className="btn-primary w-full justify-center">Sign out and use another account</button>
          </form>
        </div>
      </div>
    );
  }
  const roster: [string, string, string][] = [
    ["Top G", "Coordinator", "#7c5cff"], ["Hunter", "Lead research", "#22d3ee"], ["Jordan", "Outreach", "#f472b6"],
    ["Quinn", "Discovery & deals", "#fbbf24"], ["Dana", "Delivery", "#34d399"],
  ];
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      {/* Brand panel */}
      <section className="relative hidden overflow-hidden border-r border-line bg-sidebar lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div aria-hidden className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(40rem 26rem at 20% 0%, rgb(124 92 255 / 0.22), transparent 70%), radial-gradient(30rem 20rem at 100% 100%, rgb(34 211 238 / 0.10), transparent 70%)" }} />
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.35]"
          style={{ backgroundImage: "linear-gradient(var(--color-line) 1px, transparent 1px), linear-gradient(90deg, var(--color-line) 1px, transparent 1px)", backgroundSize: "44px 44px", maskImage: "radial-gradient(ellipse at 30% 20%, black, transparent 70%)" }} />
        <div className="relative flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-192.png" alt="" width={32} height={32} className="rounded-[9px]" />
          <span className="text-[15px] font-semibold tracking-[-0.01em]">Marvz Studio</span>
        </div>
        <div className="relative max-w-[460px]">
          <p className="eyebrow mb-4">Squad CRM</p>
          <h2 className="text-[40px] font-semibold leading-[1.05] tracking-[-0.035em]">
            The operating system for your <span className="text-gradient">AI agency</span>.
          </h2>
          <p className="mt-4 text-[15px] text-ink-2">
            Your Grok squad finds, qualifies and closes clients. You approve what matters. Every move is logged.
          </p>
          <ul className="mt-8 grid gap-2">
            {roster.map(([name, role, color]) => (
              <li key={name} className="flex items-center gap-3 rounded-[10px] border border-line bg-panel/70 px-3 py-2">
                <span className="flex size-7 items-center justify-center rounded-[8px] text-[11px] font-semibold text-white"
                  style={{ background: `linear-gradient(140deg, ${color}, color-mix(in oklab, ${color} 50%, black))` }}>{name.split(" ").map((w) => w[0]).join("")}</span>
                <span className="font-medium">{name}</span>
                <span className="text-ink-3">{role}</span>
                <span className="ml-auto flex items-center gap-1.5 text-[11.5px] text-emerald-300"><span className="size-1.5 rounded-full bg-emerald-400" />ready</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-[12px] text-ink-3">Human approval on every outreach batch · Row-level security per agent</p>
      </section>

      {/* Sign-in form */}
      <div className="flex items-center justify-center px-4 py-[max(24px,env(safe-area-inset-top))]">
        <form action={signIn} className="w-full max-w-[360px]">
          <div className="mb-8">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-192.png" alt="" width={44} height={44} className="mb-5 rounded-[12px] lg:hidden" />
            <h1 className="text-[24px] font-semibold tracking-[-0.025em]">Squad CRM</h1>
            <p className="mt-1 text-[14px] text-ink-3">Marvz Studio · sign in to continue</p>
          </div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required autoComplete="email" autoCapitalize="none" className="input mb-4 h-10" placeholder="name@studio.com" />
          <label className="label" htmlFor="password">Password</label>
          <input id="password" name="password" type="password" required autoComplete="current-password" className="input mb-5 h-10" placeholder="Password" />
          {error && <p role="alert" className="mb-4 rounded-[8px] border border-rose-400/20 bg-rose-400/10 px-3 py-2.5 text-[13px] text-rose-300">{error}</p>}
          <button className="btn-primary h-10 w-full justify-center text-[14px]">Sign in</button>
          <p className="mt-6 text-[12px] text-ink-3">Squad members only. Ask an admin if you need access.</p>
        </form>
      </div>
    </div>
  );
}
