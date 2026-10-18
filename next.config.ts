import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

// Next.js inlines its bootstrap and RSC payload scripts, so script-src needs
// 'unsafe-inline' unless nonces are introduced. Everything else is locked down.
// The policy is production-only because React's dev tooling needs eval.
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self'",
  "connect-src 'self' https://api.lanyard.rest wss://api.lanyard.rest",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  // The scheme is HTTPS everywhere this is deployed; a year, without preload, is safe to ship.
  ...(isProduction
    ? [
        { key: "Content-Security-Policy", value: contentSecurityPolicy },
        { key: "Strict-Transport-Security", value: "max-age=31536000" },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      ]
    : []),
];

const config: NextConfig = {
  // `NEXT_OUTPUT=standalone` builds a self-contained server for Docker (see the Dockerfile). Other hosts use the default.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  // The dev server refuses requests whose Origin is not localhost, which silently stops the page from
  // hydrating. 127.0.0.1 is the same machine, so it is safe to allow; other hosts need an explicit entry.
  allowedDevOrigins: ["127.0.0.1"],
  poweredByHeader: false,
  reactStrictMode: true,
  // Keep `next dev` from writing an AGENTS.md into the working tree.
  agentRules: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // JSON routes and the owner's report are for the site and its owner, not for search engines.
      { source: "/api/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
      { source: "/status", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
      {
        // Filenames are not content-hashed (scripts/build-fonts.py writes fixed names),
        // so cache for a week and revalidate in the background rather than "immutable".
        source: "/fonts/:file*",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" }],
      },
    ];
  },
};

export default config;
