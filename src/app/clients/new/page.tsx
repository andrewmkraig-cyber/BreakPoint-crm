import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { NewClientForm } from "@/app/clients/new/new-client-form";

export const dynamic = "force-dynamic";

export default function NewClientPage() {
  return (
    <div className="space-y-6">
      <Link href="/clients" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-navy">
        <ArrowLeft className="h-3 w-3" /> Back to clients
      </Link>

      <PageHeader
        eyebrow="Accounts"
        title="New Client"
        description="Paste a company URL to auto-fill, or enter details manually. Every field stays editable."
      />

      <NewClientForm />
    </div>
  );
}
