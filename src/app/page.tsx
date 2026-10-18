import { Dashboard } from "@/components/Dashboard";

// Panels read secrets and live upstream data per request, so the page is never
// prerendered at build time. Upstream results are cached in-process instead.
export const dynamic = "force-dynamic";
// Platform function limit (seconds). Each upstream is cut off after 12 s, so a page never needs more than this.
export const maxDuration = 30;

export default function Page() {
  return (
    <main className="page">
      <a className="skip-link" href="#activity-title">
        skip to github activity
      </a>
      <h1 className="visually-hidden">nothikemu personal dashboard</h1>
      <Dashboard />
    </main>
  );
}
