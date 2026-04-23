import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { InvoiceBuilder } from "@/components/invoice-builder";

const DRAFT_KEY = "invoice_draft_v1";

type Search = { scan?: boolean };

export const Route = createFileRoute("/invoices/new")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    scan: search.scan === true || search.scan === "true" || search.scan === "1",
  }),
  component: () => {
    const { scan } = Route.useSearch();
    return (
      <AppShell>
        <InvoiceBuilder mode="new" autoScan={!!scan} draftKey={DRAFT_KEY} />
      </AppShell>
    );
  },
});
