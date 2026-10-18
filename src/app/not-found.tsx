import Link from "next/link";
import type { Metadata } from "next";
import { NoticePage } from "@/components/NoticePage";
import { site } from "@/config/site";

export const metadata: Metadata = { title: `not found · ${site.title}` };

export default function NotFound() {
  return (
    <NoticePage title="not found" text="nothing lives at this address">
      <Link className="notice__link" href="/">
        back to the dashboard
      </Link>
    </NoticePage>
  );
}
