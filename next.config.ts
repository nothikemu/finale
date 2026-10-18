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
  ...(isProduction ? [{ key: "Content-Security-Policy", value: contentSecurityPolicy }] : []),
];

const config: NextConfig = {
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
