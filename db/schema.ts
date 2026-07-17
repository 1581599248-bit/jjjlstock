import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const managerOverviewCache = sqliteTable("manager_overview_cache", {
  cacheKey: text("cache_key").primaryKey(),
  companyId: text("company_id").notNull(),
  period: text("period").notNull(),
  managerId: text("manager_id").notNull(),
  payload: text("payload").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("manager_overview_company_period_idx").on(table.companyId, table.period),
  index("manager_overview_updated_at_idx").on(table.updatedAt),
]);
