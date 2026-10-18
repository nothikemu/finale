import Link from "next/link";
import { NoticePage } from "@/components/NoticePage";

export default function NotFound() {
  return (
    <NoticePage title="not found" text="nothing lives at this address">
      <Link className="notice__link" href="/">
        back to the dashboard
      </Link>
    </NoticePage>
  );
}
