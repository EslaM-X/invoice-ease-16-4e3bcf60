Plan: Update E. Hesham's displayed title to the full "COO — Chief Operating Officer" form in all relevant UI surfaces.

1. **Leadership Tasks Card** (`src/components/leadership-tasks-card.tsx`)
   - Change the COO leader metadata so the bilingual label shows the full title:
     - Arabic: "مدير العمليات التنفيذي — COO" (or "المدير التنفيذي للعمليات — COO")
     - English: "COO — Chief Operating Officer"
   - Keep the existing `short: "COO"` for badges/abbreviations if needed.
   - Ensure the card header and sub-label render the full title clearly without breaking the existing two-column layout.

2. **Other surfaces that display a title for E. Hesham**
   - Search for any hardcoded role labels tied to `e.hesham@steinheim-eg.com` (e.g., task manager headers, profile cards, audit logs, admin/distributor dialogs).
   - Update those labels to the same "COO — Chief Operating Officer" / "مدير العمليات التنفيذي — COO" title.

3. **Verification**
   - Build passes.
   - Dashboard renders the leadership card with the full title for E. Hesham and the CEO title for K. Elsharbatly remains unchanged.
