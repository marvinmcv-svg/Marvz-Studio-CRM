import { Sparkles } from "lucide-react";
import { redirect } from "next/navigation";
import { isLive } from "@/lib/supabase/env";
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

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (!isLive) redirect("/");
  const { error } = await searchParams;
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
