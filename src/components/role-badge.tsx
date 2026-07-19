import { useTeamProfiles } from "@/lib/team-profiles";

type Props = {
  email?: string | null;
  userId?: string | null;
  className?: string;
  size?: "xs" | "sm";
};

/** Small pill showing the person's job title (COO/CEO/CFO/...) in their chosen color.
 *  Renders nothing when the profile has no job_title. */
export function RoleBadge({ email, userId, className = "", size = "xs" }: Props) {
  const team = useTeamProfiles();
  const profile = userId ? team.byId(userId) : email ? team.byEmail(email) : null;
  const title = profile?.job_title?.trim();
  if (!title) return null;
  const color = profile?.job_title_color || "#c9a84c";
  const pad = size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-1.5 py-[1px] text-[10px]";
  return (
    <span
      className={`inline-flex items-center rounded-full font-bold uppercase tracking-wider ring-1 ${pad} ${className}`}
      style={{
        color,
        backgroundColor: `${color}1f`,
        // @ts-ignore CSS custom border color via ring
        boxShadow: `inset 0 0 0 1px ${color}66`,
      }}
      title={title}
    >
      {title}
    </span>
  );
}
