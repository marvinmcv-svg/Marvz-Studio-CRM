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
        <div className="float w-full max-w-[400px] rounded-[26px] p-6">
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
  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-[max(24px,env(safe-area-inset-top))]">
      <form action={signIn} className="float w-full max-w-[380px] rounded-[26px] px-6 pb-6 pt-8">
        <div className="mb-7 flex flex-col items-center text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-192.png" alt="" width={72} height={72}
            className="rounded-[17px] shadow-[0_10px_28px_-10px_rgb(10_132_255/0.75)]" />
          <h1 className="mt-4 text-[26px] font-bold tracking-[-0.022em]">Squad CRM</h1>
          <p className="mt-1 text-[14px] text-ink-3">Marvz Studio · sign in to continue</p>
        </div>
        <label className="label" htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required autoComplete="email" autoCapitalize="none" className="input mb-4 h-11" placeholder="name@studio.com" />
        <label className="label" htmlFor="password">Password</label>
        <input id="password" name="password" type="password" required autoComplete="current-password" className="input mb-5 h-11" placeholder="Password" />
        {error && <p role="alert" className="mb-4 rounded-xl bg-rose-400/10 px-3 py-2.5 text-[13px] text-rose-300">{error}</p>}
        <button className="btn-primary h-11 w-full justify-center text-[15px]">Sign in</button>
        <p className="mt-5 text-center text-[12px] text-ink-3">Squad members only. Ask an admin if you need access.</p>
      </form>
    </div>
  );
}
