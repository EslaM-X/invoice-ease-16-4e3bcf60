import { User } from "lucide-react";
import { useTeamProfiles } from "@/lib/team-profiles";
import { RoleBadge } from "@/components/role-badge";

type Props = {
  email?: string | null;
  label?: string;
  className?: string;
  size?: "xs" | "sm";
};

/** Compact badge showing who created/edited a record, with avatar. */
export function AuthorBadge({ email, label, className = "", size = "xs" }: Props) {
  const team = useTeamProfiles();
  if (!email) return null;
  const profile = team.byEmail(email);
  const short = profile?.display_name || email.split("@")[0];
  const dim = size === "sm" ? "h-5 w-5" : "h-4 w-4";
  const text = size === "sm" ? "text-xs" : "text-[10px]";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full bg-muted px-1.5 py-0.5 font-medium text-muted-foreground ${text} ${className}`}
      title={`${label ?? ""}${label ? " · " : ""}${email}`}
    >
      {profile?.avatar_url ? (
        <img
          src={profile.avatar_url}
          alt=""
          className={`${dim} rounded-full object-cover no-print`}
        />
      ) : (
        <span className={`flex ${dim} items-center justify-center rounded-full bg-primary/15 text-primary no-print`}>
          <User className="h-2.5 w-2.5" />
        </span>
      )}
      <span className="truncate">{short}</span>
      <RoleBadge email={email} size={size} className="no-print" />
    </span>
  );
}

