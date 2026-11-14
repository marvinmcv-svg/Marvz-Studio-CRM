import { Sparkles } from "lucide-react";
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
        <div className="card w-full max-w-[400px] p-6">
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
    <div className="flex min-h-dvh items-center justify-center px-4">
      <form action={signIn} className="card w-full max-w-[360px] p-6">
        <div className="mb-6 flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-accent text-accent-ink">
            <Sparkles size={16} />
          </span>
          <div>
            <div className="font-semibold">Squad CRM</div>
            <div className="text-[12px] text-ink-3">Marvz Studio · team sign-in</div>
          </div>
        </div>
        <label className="label" htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required autoComplete="email" className="input mb-3" />
        <label className="label" htmlFor="password">Password</label>
        <input id="password" name="password" type="password" required autoComplete="current-password" className="input mb-4" />
        {error && <p className="mb-3 rounded-lg bg-rose-400/10 px-3 py-2 text-[12px] text-rose-300">{error}</p>}
        <button className="btn-primary w-full justify-center">Sign in</button>
        <p className="mt-4 text-[12px] text-ink-3">Accounts are created in Supabase and linked to a squad member (see README).</p>
      </form>
    </div>
  );
}
