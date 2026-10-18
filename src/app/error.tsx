"use client";

import { NoticePage } from "@/components/NoticePage";

// Shown if something throws while rendering. Nothing about the failure is shown to visitors.
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <NoticePage title="something broke" text="the page could not be shown">
      <button className="notice__link" type="button" onClick={reset}>
        try again
      </button>
    </NoticePage>
  );
}
