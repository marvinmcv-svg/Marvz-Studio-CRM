"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

/** Re-renders the current page whenever any agent writes to the activity log. */
export function LiveRefresh() {
  const router = useRouter();
  useEffect(() => {
    const sb = supabaseBrowser();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const channel = sb
      .channel("squad-activity")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "activity_log" }, () => {
        clearTimeout(timer);
        timer = setTimeout(() => router.refresh(), 400);
      })
      .subscribe();
    return () => {
      clearTimeout(timer);
      sb.removeChannel(channel);
    };
  }, [router]);
  return null;
}
