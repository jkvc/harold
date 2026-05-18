import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export type MessageRole = "user" | "harold";

export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey(),
    visitorId: text("visitor_id").notNull(),
    role: text("role", { enum: ["user", "harold"] }).notNull(),
    content: text("content").notNull(),
    replyToId: text("reply_to_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("messages_visitor_created_at_idx").on(
      table.visitorId,
      table.createdAt,
    ),
    index("messages_visitor_created_at_id_idx").on(
      table.visitorId,
      table.createdAt,
      table.id,
    ),
    check("messages_role_check", sql`${table.role} in ('user', 'harold')`),
    foreignKey({
      columns: [table.replyToId],
      foreignColumns: [table.id],
      name: "messages_reply_to_id_fk",
    }),
  ],
);

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
