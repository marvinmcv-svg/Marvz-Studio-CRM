import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Squad CRM — Marvz Studio",
    short_name: "Squad CRM",
    description: "Pipeline, approvals, deals and delivery for Marvz Studio and its agent squad.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["window-controls-overlay", "standalone"],
    orientation: "any",
    background_color: "#000000",
    theme_color: "#000000",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Pipeline", url: "/pipeline", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "New lead", url: "/leads/new", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Approvals", url: "/approvals", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Deal builder", url: "/deals/new", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
