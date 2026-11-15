import { expect, type Page, type TestInfo } from "@playwright/test";
import demo from "../../src/lib/demo/data.json" with { type: "json" };

export const LEAD_ID: string = (demo as { leads: { id: string }[] }).leads[0].id;
export const PROJECT_ID: string = (demo as { projects: { id: string }[] }).projects[0].id;
export const LEAD_NAME: string = (demo as { companies: { id: string; name: string }[]; leads: { id: string; company_id: string }[] })
  .companies.find((c) => c.id === (demo as { leads: { company_id: string }[] }).leads[0].company_id)!.name;

export const PAGES: { path: string; title: RegExp }[] = [
  { path: "/", title: /Good (morning|afternoon|evening)/ },
  { path: "/pipeline", title: /Pipeline/ },
  { path: "/pipeline?view=table", title: /Pipeline/ },
  { path: `/leads/${LEAD_ID}`, title: new RegExp(LEAD_NAME) },
  { path: `/leads/${LEAD_ID}?tab=history`, title: new RegExp(LEAD_NAME) },
  { path: "/leads/new", title: /New lead/ },
  { path: "/approvals", title: /approvals/i },
  { path: "/escalations", title: /Escalations/ },
  { path: "/activity", title: /Activity/ },
  { path: "/deals", title: /Deals/ },
  { path: "/deals/new", title: /Deal builder/ },
  { path: "/projects", title: /Projects/ },
  { path: `/projects/${PROJECT_ID}`, title: /./ },
  { path: "/catalogue", title: /catalogue/i },
  { path: "/revenue", title: /Revenue/ },
  { path: "/care", title: /Care/ },
  { path: "/growth", title: /Testimonials|Growth/ },
  { path: "/lessons", title: /Lessons/ },
  { path: "/dnc", title: /contact/i },
  { path: "/team", title: /Team/ },
];

export const isMobile = (info: TestInfo) => info.project.name.startsWith("iphone");

/** Collects console errors and uncaught exceptions for the page. */
export function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

/** Fails if anything sticks out past the right edge (sideways scrolling on phones). */
export async function expectNoHorizontalOverflow(page: Page) {
  const res = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const over = document.documentElement.scrollWidth - vw;
    const culprits: string[] = [];
    if (over > 1) {
      for (const el of Array.from(document.querySelectorAll("body *"))) {
        const r = (el as HTMLElement).getBoundingClientRect();
        if (r.right > vw + 1 && r.width > 0) {
          // skip descendants of scrollable containers (they scroll inside their box)
          let p = el.parentElement, inScroller = false;
          while (p && p !== document.body) {
            const ox = getComputedStyle(p).overflowX;
            if (ox === "auto" || ox === "scroll" || ox === "hidden") { inScroller = true; break; }
            p = p.parentElement;
          }
          if (!inScroller) culprits.push(`${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).slice(0, 60)} right=${Math.round(r.right)}`);
        }
        if (culprits.length >= 5) break;
      }
    }
    return { over, culprits };
  });
  expect(res.over, `page is ${res.over}px wider than the screen: ${res.culprits.join(" | ")}`).toBeLessThanOrEqual(1);
}

/** Every button/link a user can see has a name a screen reader can announce. */
export async function expectNamedControls(page: Page) {
  const unnamed = await page.evaluate(() =>
    Array.from(document.querySelectorAll("button, a[href], [role=button]"))
      .filter((el) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const name = (el.getAttribute("aria-label") || (el as HTMLElement).innerText || el.getAttribute("title") || "").trim();
        return !name;
      })
      .map((el) => el.outerHTML.slice(0, 120)));
  expect(unnamed, `controls without an accessible name:\n${unnamed.join("\n")}`).toEqual([]);
}
