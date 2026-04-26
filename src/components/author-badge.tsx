import { User } from "lucide-react";

type Props = {
  email?: string | null;
  label?: string;
  className?: string;
};

/** Compact badge showing who created/edited a record. */
export function AuthorBadge({ email, label, className = "" }: Props) {
  if (!email) return null;
  const short = email.split("@")[0];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground ${className}`}
      title={`${label ?? ""}${label ? " · " : ""}${email}`}
    >
      <User className="h-2.5 w-2.5" />
      {short}
    </span>
  );
}
