"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

/** Wait this long after the last change so a burst of agent writes becomes one refresh. */
const SETTLE_MS = 1500;
/** Never refresh more often than this, however busy the agents are. */
const MIN_INTERVAL_MS = 10_000;

const isEditing = () => {
  const el = document.activeElement;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT"
    || (el as HTMLElement).isContentEditable);
};

/**
 * Re-renders the current page when agents write to the activity log.
 * A refresh re-runs every query on the page, so it is batched and throttled,
 * skipped while the tab is hidden (caught up when it becomes visible again),
 * and postponed while the user is typing in a field or has a dialog open.
 */
export function LiveRefresh() {
  const router = useRouter();
  useEffect(() => {
    const sb = supabaseBrowser();
    let dirty = false;
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const flush = () => {
      clearTimeout(timer);
      if (!dirty) return;
      if (document.visibilityState !== "visible") return;            // caught up on visibilitychange
      if (isEditing() || document.querySelector("[data-modal-open]")) {
        timer = setTimeout(flush, 2000);                               // try again once they're done
        return;
      }
      const wait = last + MIN_INTERVAL_MS - Date.now();
      if (wait > 0) { timer = setTimeout(flush, wait); return; }
      dirty = false;
      last = Date.now();
      router.refresh();
    };
    const schedule = () => {
      dirty = true;
      clearTimeout(timer);
      timer = setTimeout(flush, SETTLE_MS);
    };
    const onVisible = () => { if (document.visibilityState === "visible") flush(); };

    const channel = sb
      .channel("squad-activity")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "activity_log" }, schedule)
      .subscribe();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      sb.removeChannel(channel);
    };
  }, [router]);
  return null;
}
