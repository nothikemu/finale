import type { MetadataRoute } from "next";

// The dashboard itself is public. Its JSON routes and the owner's /status page are not for search engines.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/status"] } };
}
