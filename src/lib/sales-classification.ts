export type CustomerCategoryKey = "engineer" | "finishing_company" | "company" | "end_user";
export type SalesChannelKey = "showroom" | "distributor" | "referral" | "online" | "event";

export const CUSTOMER_CATEGORIES: Array<{ value: CustomerCategoryKey; ar: string; en: string }> = [
  { value: "engineer", ar: "مهندس", en: "Engineer" },
  { value: "finishing_company", ar: "شركة تشطيب", en: "Finishing company" },
  { value: "company", ar: "شركة / مؤسسة", en: "Company" },
  { value: "end_user", ar: "عميل نهائي / مستخدم", en: "End user" },
];

export const SALES_CHANNELS: Array<{ value: SalesChannelKey; ar: string; en: string }> = [
  { value: "showroom", ar: "معرض", en: "Showroom" },
  { value: "distributor", ar: "موزّع", en: "Distributor" },
  { value: "referral", ar: "معارف / ترشيح", en: "Referral" },
  { value: "online", ar: "أونلاين", en: "Online" },
  { value: "event", ar: "معرض / حدث", en: "Exhibition / event" },
];

export const labelForCustomerCategory = (value: string | null | undefined, lang: "ar" | "en") => {
  const row = CUSTOMER_CATEGORIES.find((x) => x.value === value);
  return row ? (lang === "ar" ? row.ar : row.en) : (lang === "ar" ? "غير مصنف" : "Uncategorized");
};

export const labelForSalesChannel = (value: string | null | undefined, lang: "ar" | "en") => {
  const row = SALES_CHANNELS.find((x) => x.value === value);
  return row ? (lang === "ar" ? row.ar : row.en) : (lang === "ar" ? "غير مصنف" : "Uncategorized");
};

export const categoryBadgeClass = (value?: string | null) => {
  switch (value) {
    case "engineer": return "border-violet-500/35 bg-violet-500/10 text-violet-700 dark:text-violet-300";
    case "finishing_company": return "border-blue-500/35 bg-blue-500/10 text-blue-700 dark:text-blue-300";
    case "company": return "border-slate-500/35 bg-slate-500/10 text-slate-700 dark:text-slate-300";
    case "distributor": return "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    case "online": return "border-cyan-500/35 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300";
    case "event": return "border-fuchsia-500/35 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300";
    case "referral": return "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    default: return "border-border bg-muted/50 text-muted-foreground";
  }
};
