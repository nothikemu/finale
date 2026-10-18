import type { MetadataRoute } from "next";
import { site } from "@/config/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: site.title,
    short_name: site.title,
    description: site.description,
    start_url: "/",
    display: "browser",
    background_color: "#000000",
    theme_color: "#000000",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
