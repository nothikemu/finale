import type { Metadata, Viewport } from "next";
import { preconnect, preload } from "react-dom";
import { site } from "@/config/site";
import "@/styles/tokens.css";
import "@/styles/base.css";
import "@/styles/layout.css";
import "@/styles/panel.css";
import "@/styles/panels.css";
import "@/styles/effects.css";

export const metadata: Metadata = {
  title: site.title,
  description: site.description,
};

export const viewport: Viewport = {
  themeColor: "#000000",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Start the two font files before the CSS that references them is parsed.
  for (const cut of ["Regular", "Medium"]) {
    preload(`/fonts/JetBrainsMonoNerdFontMono-${cut}.woff2`, { as: "font", type: "font/woff2", crossOrigin: "anonymous" });
  }
  // The Discord panel talks to Lanyard straight from the browser; open that connection early.
  preconnect("https://api.lanyard.rest", { crossOrigin: "anonymous" });
  return (
    <html lang="en" data-glass={site.glass}>
      <body>{children}</body>
    </html>
  );
}
