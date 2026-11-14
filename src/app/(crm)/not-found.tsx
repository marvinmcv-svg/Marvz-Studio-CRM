import Link from "next/link";
import { Empty } from "@/components/ui";

export default function CrmNotFound() {
  return (
    <div className="p-4 md:p-6">
      <div className="card">
        <Empty title="Not found">
          This record doesn&apos;t exist, was removed, or your role can&apos;t see it.{" "}
          <Link href="/pipeline" className="text-accent-2 hover:underline">Back to the pipeline</Link>
        </Empty>
      </div>
    </div>
  );
}
