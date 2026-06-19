import { createFileRoute, Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ShieldCheck, Lock, KeyRound, FileSearch, UserCog, Database,
  Server, Mail, AlertCircle,
} from "lucide-react";

export const Route = createFileRoute("/trust")({
  head: () => ({
    meta: [
      { title: "Trust & Security — Steinheim Suite" },
      { name: "description", content: "How Steinheim Suite protects access, data, and audit trails for our team." },
      { property: "og:title", content: "Trust & Security — Steinheim Suite" },
      { property: "og:description", content: "How Steinheim Suite protects access, data, and audit trails for our team." },
    ],
  }),
  component: TrustPage,
});

function Section({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
          <Icon className="w-5 h-5" />
        </div>
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      <div className="text-sm text-muted-foreground leading-relaxed space-y-2">{children}</div>
    </Card>
  );
}

function TrustPage() {
  const lastReviewed = "June 2026";
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto max-w-4xl px-4 sm:px-6 py-10 sm:py-14">
        <div className="mb-8 sm:mb-10">
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck className="w-7 h-7 text-primary" />
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">Trust &amp; Security</h1>
          </div>
          <p className="text-muted-foreground max-w-2xl">
            This page is maintained by the Steinheim Suite team to answer common security and privacy questions
            about the application. It describes controls that are visible inside the product today; it is
            <em> not </em> an independent certification or third-party audit.
          </p>
          <div className="flex flex-wrap gap-2 mt-4">
            <Badge variant="outline">Last reviewed · {lastReviewed}</Badge>
            <Badge variant="outline">Internal business application</Badge>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4">
          <Section icon={KeyRound} title="Access &amp; authentication">
            <p>Steinheim Suite is an invite/approval-only internal system. Sign-in uses email/password
              through our managed identity provider, and every new account is held in a pending state until
              an administrator approves it.</p>
            <p>Administrators can revoke access at any time. Sessions are protected by the platform's
              standard token lifetime and refresh flow.</p>
          </Section>

          <Section icon={UserCog} title="Roles &amp; authorization">
            <p>The application uses role-based access (admin, manager, purchasing, sales, staff). Sensitive
              operations — including inventory adjustments, deletion of purchase orders, approving users, and
              changing financial pricing — are restricted to specific roles and enforced by database-level
              Row-Level Security policies, not just in the UI.</p>
          </Section>

          <Section icon={Database} title="Data handling">
            <p>Application data (customers, invoices, products, purchase orders, delivery receipts) is stored
              in our managed Postgres database. Each row is scoped to the owning team member or company and
              filtered by Row-Level Security on every read and write.</p>
            <p>Backups of business records are taken on a recurring schedule; backup audit entries are
              write-once and cannot be edited or deleted through the application.</p>
          </Section>

          <Section icon={FileSearch} title="Audit logging">
            <p>The platform keeps an immutable audit log of sensitive actions including approvals, role
              changes, invoice edits, delivery-receipt signing, and inventory resets. Administrators can
              review the log inside the app.</p>
          </Section>

          <Section icon={Lock} title="Transport &amp; storage security">
            <p>All traffic between users' browsers and the platform is served over HTTPS/TLS. File
              attachments (chat files, signed delivery receipts, product images) are stored in scoped
              storage buckets with access policies that restrict reads and writes to the appropriate users.</p>
          </Section>

          <Section icon={Server} title="Subprocessors &amp; hosting">
            <p>Steinheim Suite is hosted on Lovable Cloud (which uses Supabase for database, auth, and
              storage) and is delivered through Lovable's published-site infrastructure. The application
              may use additional integrations (for example, AI features, push notifications, or email
              delivery) on an opt-in basis.</p>
            <p>For a current list of subprocessors used by your tenant, contact your administrator.</p>
          </Section>

          <Section icon={AlertCircle} title="Vulnerability reporting">
            <p>If you believe you have found a security issue in Steinheim Suite, please contact your
              administrator or email the address below. Please do not publicly disclose the issue until
              we have had a reasonable opportunity to investigate and respond.</p>
          </Section>

          <Section icon={Mail} title="Contact">
            <p>Security and privacy questions can be sent to your Steinheim Suite administrator. The
              contents of this page can be updated by the app owner at any time.</p>
          </Section>
        </div>

        <div className="mt-8 text-xs text-muted-foreground">
          <Link to="/" className="underline hover:text-foreground">Back to app</Link>
        </div>
      </div>
    </div>
  );
}
