// Single source of truth for all customizable navigation entries and dashboard cards.
// Used by both the AppShell (rendering) and Access Studio (super-admin editing).
//
// Adding a new page? Add it here and it appears in Access Studio automatically.

export type NavKey = string;

export type NavItemDef = {
  key: NavKey;
  to: string;
  labelAr: string;
  labelEn: string;
  group?: string; // parent group key (for children)
  requires?: "admin" | "executive" | "call_center" | "purchasing" | "cfo" | null;
};

export type NavGroupDef = {
  key: NavKey;
  labelAr: string;
  labelEn: string;
  group: true;
};

export type NavEntry = NavItemDef | NavGroupDef;

/** Top-level nav order (groups + solo items). */
export const NAV_TOP_ORDER: NavKey[] = [
  "dashboard",
  "tasks",
  "inventory_group",
  "documents_group",
  "procurement_group",
  "reports_group",
  "call_center_group",
  "communication_group",
  "settings_group",
];

export const NAV_GROUPS: NavGroupDef[] = [
  { key: "inventory_group", labelAr: "المخزون", labelEn: "Inventory", group: true },
  { key: "documents_group", labelAr: "الوثائق", labelEn: "Documents", group: true },
  { key: "procurement_group", labelAr: "المشتريات والربح", labelEn: "Procurement & Profit", group: true },
  { key: "reports_group", labelAr: "التقارير", labelEn: "Reports", group: true },
  { key: "call_center_group", labelAr: "الكول سنتر", labelEn: "Call Center", group: true },
  { key: "communication_group", labelAr: "التواصل", labelEn: "Communication", group: true },
  { key: "settings_group", labelAr: "الإعدادات", labelEn: "Settings", group: true },
];

export const NAV_ITEMS: NavItemDef[] = [
  { key: "dashboard", to: "/dashboard", labelAr: "لوحة التحكم", labelEn: "Dashboard" },
  { key: "tasks", to: "/tasks", labelAr: "المهام", labelEn: "Tasks" },

  // Inventory
  { key: "products", to: "/products", labelAr: "المنتجات", labelEn: "Products", group: "inventory_group" },
  { key: "in_transit", to: "/in-transit", labelAr: "في الطريق", labelEn: "In Transit", group: "inventory_group" },
  { key: "stock_intake", to: "/stock-intake", labelAr: "استلام مخزون", labelEn: "Stock Intake", group: "inventory_group", requires: "executive" },
  { key: "inventory", to: "/inventory", labelAr: "المخزون", labelEn: "Inventory", group: "inventory_group" },
  { key: "inventory_traceability", to: "/inventory-traceability", labelAr: "متتبع المخزون", labelEn: "Traceability", group: "inventory_group" },
  { key: "inventory_audit", to: "/inventory-audit", labelAr: "تدقيق المخزون", labelEn: "Inventory Audit", group: "inventory_group" },
  { key: "inventory_reconcile", to: "/inventory-reconcile", labelAr: "تسوية المخزون", labelEn: "Inventory Reconcile", group: "inventory_group" },
  { key: "inventory_consistency", to: "/inventory-consistency", labelAr: "فحص الاتساق", labelEn: "Consistency Check", group: "inventory_group", requires: "executive" },
  { key: "defective_items", to: "/defective-items", labelAr: "المنتجات المعيبة", labelEn: "Defective Items", group: "inventory_group" },
  { key: "qr_price_list", to: "/qr-price-list", labelAr: "قائمة أسعار QR", labelEn: "QR Price List", group: "inventory_group" },

  // Documents
  { key: "invoices", to: "/invoices", labelAr: "الفواتير", labelEn: "Invoices", group: "documents_group" },
  { key: "invoice_drafts", to: "/invoices/drafts", labelAr: "المسودات", labelEn: "Drafts", group: "documents_group" },
  { key: "invoices_archive", to: "/invoices/archive", labelAr: "أرشيف الفواتير", labelEn: "Invoice Archive", group: "documents_group" },
  { key: "delivery_receipts", to: "/delivery-receipts", labelAr: "محاضر الاستلام", labelEn: "Delivery Receipts", group: "documents_group" },
  { key: "delivery_receipts_archive", to: "/delivery-receipts/archive", labelAr: "أرشيف المحاضر", labelEn: "DR Archive", group: "documents_group" },
  { key: "delivery_audit", to: "/delivery-audit", labelAr: "تدقيق محاضر الاستلام", labelEn: "Delivery Audit", group: "documents_group" },
  { key: "fulfillment", to: "/fulfillment", labelAr: "التوريدات", labelEn: "Fulfillment", group: "documents_group" },
  { key: "fulfillment_decisions", to: "/fulfillment-decisions", labelAr: "قرارات التوريد", labelEn: "Fulfillment Decisions", group: "documents_group" },
  { key: "fulfillment_audit", to: "/fulfillment-audit", labelAr: "تدقيق التوريد", labelEn: "Fulfillment Audit", group: "documents_group" },
  { key: "invoices_with_system_notes", to: "/invoices-system-notes", labelAr: "ملاحظات النظام", labelEn: "System Notes", group: "documents_group" },
  { key: "customers", to: "/customers", labelAr: "العملاء", labelEn: "Customers", group: "documents_group" },

  // Procurement (executive)
  { key: "purchase_orders", to: "/purchase-orders", labelAr: "أوامر الشراء", labelEn: "Purchase Orders", group: "procurement_group", requires: "purchasing" },
  { key: "po_tracking", to: "/po-tracking", labelAr: "تتبع أوامر الشراء", labelEn: "PO Tracking", group: "procurement_group", requires: "purchasing" },
  { key: "stock_shortages", to: "/stock-shortages", labelAr: "تقرير النواقص", labelEn: "Stock Shortages", group: "inventory_group" },
  { key: "profit_calculator", to: "/profit-calculator", labelAr: "حاسبة الربح", labelEn: "Profit Calculator", group: "procurement_group", requires: "cfo" },
  { key: "profit_scenarios", to: "/profit-scenarios", labelAr: "السيناريوهات المحفوظة", labelEn: "Saved Scenarios", group: "procurement_group", requires: "cfo" },

  // Reports
  { key: "sales_analysis", to: "/sales-analysis", labelAr: "تحليل المبيعات", labelEn: "Sales Analysis", group: "reports_group" },
  { key: "engineers_analysis", to: "/engineers-analysis", labelAr: "تحليل المهندسين", labelEn: "Engineers Analysis", group: "reports_group" },
  { key: "sales_range", to: "/sales-range", labelAr: "المبيعات في فترة", labelEn: "Sales Range", group: "reports_group" },
  { key: "shipping_order", to: "/shipping-order", labelAr: "أمر الشحن", labelEn: "Shipping Order", group: "reports_group" },
  { key: "profits", to: "/profits", labelAr: "الأرباح", labelEn: "Profits", group: "reports_group", requires: "executive" },

  // Call center
  { key: "call_center", to: "/call-center", labelAr: "الكول سنتر", labelEn: "Call Center", group: "call_center_group", requires: "call_center" },
  { key: "call_center_reports", to: "/call-center-reports", labelAr: "تقارير الكول سنتر", labelEn: "Call Center Reports", group: "call_center_group", requires: "call_center" },

  // Communication
  { key: "team_chat", to: "/team-chat", labelAr: "شات الفريق", labelEn: "Team Chat", group: "communication_group" },
  { key: "whatsapp_inbox", to: "/whatsapp", labelAr: "واتساب", labelEn: "WhatsApp Inbox", group: "communication_group" },

  // Settings
  { key: "settings", to: "/settings", labelAr: "الإعدادات", labelEn: "Settings", group: "settings_group" },
  { key: "audit_log", to: "/audit-log", labelAr: "سجل التدقيق", labelEn: "Audit Log", group: "settings_group", requires: "executive" },
  { key: "finance_audit", to: "/finance-audit", labelAr: "سجل تعديلات الفواتير", labelEn: "Invoice Ledger", group: "settings_group" },
  { key: "pending_operations", to: "/pending-operations", labelAr: "العمليات المعلقة", labelEn: "Pending Operations", group: "settings_group" },
  { key: "distributors", to: "/distributors", labelAr: "الموزّعين", labelEn: "Distributors", group: "settings_group" },
  { key: "admin_panel", to: "/admin", labelAr: "لوحة الأدمن", labelEn: "Admin Panel", group: "settings_group", requires: "admin" },
  { key: "access_studio", to: "/admin/access-studio", labelAr: "استوديو الصلاحيات", labelEn: "Access Studio", group: "settings_group", requires: "admin" },
  { key: "delivery_review", to: "/delivery-review", labelAr: "مراجعة تدقيق التسليم", labelEn: "Delivery Review", group: "settings_group", requires: "admin" },
];

// -----------------------------------------------------------------------------
// Dashboard cards
// -----------------------------------------------------------------------------

export type DashboardCardKey =
  | "kpi_total_sales"
  | "kpi_total_invoices"
  | "kpi_closed_invoices"
  | "kpi_partial_invoices"
  | "kpi_open_invoices"
  | "kpi_customers"
  | "section_leadership_tasks"
  | "section_closeable_invoices"
  | "section_pending_accounts"
  | "section_distributor_approvals"
  | "section_incoming_shipments"
  | "section_po_shipments_tracker"
  | "section_inventory_values"
  | "section_sales_overview"
  | "section_recent_invoices"
  | "section_top_products"
  | "section_activity_feed";

export type DashboardCardDef = {
  key: DashboardCardKey;
  labelAr: string;
  labelEn: string;
  group: "kpi" | "section";
};

export const DASHBOARD_CARDS: DashboardCardDef[] = [
  { key: "kpi_total_sales", labelAr: "إجمالي المبيعات", labelEn: "Total Sales", group: "kpi" },
  { key: "kpi_total_invoices", labelAr: "إجمالي الفواتير", labelEn: "Total Invoices", group: "kpi" },
  { key: "kpi_closed_invoices", labelAr: "الفواتير المكتملة", labelEn: "Closed Invoices", group: "kpi" },
  { key: "kpi_partial_invoices", labelAr: "توريد جزئي", labelEn: "Partial Delivery", group: "kpi" },
  { key: "kpi_open_invoices", labelAr: "فواتير مفتوحة", labelEn: "Open Invoices", group: "kpi" },
  { key: "kpi_customers", labelAr: "العملاء", labelEn: "Customers", group: "kpi" },
  { key: "section_leadership_tasks", labelAr: "مهامي من القيادة", labelEn: "Tasks from Leadership", group: "section" },
  { key: "section_closeable_invoices", labelAr: "فواتير جاهزة للإغلاق", labelEn: "Closeable Invoices", group: "section" },
  { key: "section_pending_accounts", labelAr: "طلبات الانضمام", labelEn: "Pending Accounts", group: "section" },
  { key: "section_distributor_approvals", labelAr: "موافقات الموزّعين", labelEn: "Distributor Approvals", group: "section" },
  { key: "section_incoming_shipments", labelAr: "الشحنات القادمة", labelEn: "Incoming Shipments", group: "section" },
  { key: "section_po_shipments_tracker", labelAr: "تتبع شحنات PO", labelEn: "PO Shipments Tracker", group: "section" },
  { key: "section_inventory_values", labelAr: "قيمة المخزون", labelEn: "Inventory Values", group: "section" },
  { key: "section_sales_overview", labelAr: "نظرة عامة على المبيعات", labelEn: "Sales Overview", group: "section" },
  { key: "section_recent_invoices", labelAr: "أحدث الفواتير", labelEn: "Recent Invoices", group: "section" },
  { key: "section_top_products", labelAr: "الأكثر مبيعًا", labelEn: "Top Products", group: "section" },
  { key: "section_activity_feed", labelAr: "سجل النشاط", labelEn: "Activity Feed", group: "section" },
];

export const NAV_ITEM_BY_KEY: Record<string, NavItemDef> = Object.fromEntries(
  NAV_ITEMS.map((n) => [n.key, n]),
);
export const NAV_GROUP_BY_KEY: Record<string, NavGroupDef> = Object.fromEntries(
  NAV_GROUPS.map((g) => [g.key, g]),
);

export function navChildrenOf(groupKey: string): NavItemDef[] {
  return NAV_ITEMS.filter((n) => n.group === groupKey);
}

export function labelOf(def: NavItemDef | NavGroupDef | DashboardCardDef, lang: "ar" | "en"): string {
  return lang === "ar" ? def.labelAr : def.labelEn;
}
