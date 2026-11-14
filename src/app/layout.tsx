import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Squad CRM", template: "%s · Squad CRM" },
  description: "Marvz Studio internal CRM for Letty and the Grokbot agent squad.",
};
export const viewport: Viewport = { themeColor: "#0a0a0d", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
