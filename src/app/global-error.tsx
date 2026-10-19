"use client";

import "@/styles/tokens.css";
import "@/styles/base.css";
import "@/styles/layout.css";
import "@/styles/panel.css";
import "@/styles/panels.css";
import { ContentGuard } from "@/components/ContentGuard";
import { NoticePage } from "@/components/NoticePage";
import { site } from "@/config/site";

// Last resort: replaces the root layout itself, so it brings its own <html> and styles.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en" data-protect={site.protectContent ? "on" : undefined}>
      <body>
        <NoticePage title="something broke" text="the page could not be shown">
          <button className="notice__link" type="button" onClick={reset}>
            try again
          </button>
        </NoticePage>
        <ContentGuard />
      </body>
    </html>
  );
}
