import type { Metadata, Viewport } from "next";
import { preconnect, preload } from "react-dom";
import { site } from "@/config/site";
import { siteOrigin } from "@/lib/server/origin";
import "@/styles/tokens.css";
import "@/styles/base.css";
import "@/styles/layout.css";
import "@/styles/panel.css";
import "@/styles/panels.css";
import "@/styles/effects.css";

// Resolved per request so link previews carry this host's own address, whatever host that is.
export async function generateMetadata(): Promise<Metadata> {
  const origin = await siteOrigin();
  return {
    // Outside a request (the build's prerender of the 404 page) there is no host to read; this matches
    // what Next.js would assume, without its warning. Real requests always take the branch above.
    metadataBase: origin ?? new URL("http://localhost:3000"),
    title: site.title,
    description: site.description,
    applicationName: site.title,
    authors: [{ name: site.title, url: site.socials[1]?.href }],
    alternates: origin ? { canonical: "/" } : undefined,
    openGraph: { type: "website", siteName: site.title, title: site.title, description: site.description, url: "/" },
    twitter: { card: "summary_large_image", title: site.title, description: site.description },
  };
}

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
