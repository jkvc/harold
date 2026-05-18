import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
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

export type RunStatus = "running" | "completed" | "failed";

export const runs = pgTable(
  "runs",
  {
    id: text("id").primaryKey(),
    visitorId: text("visitor_id").notNull(),
    turnMessages: jsonb("turn_messages").$type<unknown[] | null>(),
    status: text("status", { enum: ["running", "completed", "failed"] })
      .notNull()
      .default("running"),
    model: text("model"),
    bounceCount: integer("bounce_count").notNull().default(0),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("runs_visitor_created_at_idx").on(table.visitorId, table.createdAt),
    check("runs_status_check", sql`${table.status} in ('running', 'completed', 'failed')`),
  ],
);

export const memory = pgTable(
  "memory",
  {
    id: text("id").primaryKey(),
    visitorId: text("visitor_id").notNull(),
    content: text("content").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("memory_visitor_id_unique").on(table.visitorId)],
);

export type HaroldStatus = "sleeping" | "working";

export const haroldState = pgTable(
  "harold_state",
  {
    visitorId: text("visitor_id").primaryKey(),
    status: text("status", { enum: ["sleeping", "working"] })
      .notNull()
      .default("sleeping"),
    activeRunId: text("active_run_id").references(() => runs.id),
    lastProcessedAt: timestamp("last_processed_at", { withTimezone: true }),
    lastProcessedMessageId: text("last_processed_message_id").references(
      () => messages.id,
    ),
    pendingWakeRequestedAt: timestamp("pending_wake_requested_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("harold_state_status_updated_at_idx").on(table.status, table.updatedAt),
    check("harold_state_status_check", sql`${table.status} in ('sleeping', 'working')`),
  ],
);

export type ReactionActor = "harold" | "user";

export const messageReactions = pgTable(
  "message_reactions",
  {
    id: text("id").primaryKey(),
    visitorId: text("visitor_id").notNull(),
    messageId: text("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    actor: text("actor", { enum: ["harold", "user"] }).notNull(),
    emoji: text("emoji").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("message_reactions_visitor_created_at_idx").on(
      table.visitorId,
      table.createdAt,
    ),
    uniqueIndex("message_reactions_message_actor_emoji_unique").on(
      table.messageId,
      table.actor,
      table.emoji,
    ),
    check("message_reactions_actor_check", sql`${table.actor} in ('harold', 'user')`),
  ],
);

export const haroldEvents = pgTable(
  "harold_events",
  {
    id: serial("id").primaryKey(),
    visitorId: text("visitor_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    runId: text("run_id").references(() => runs.id),
    messageId: text("message_id").references(() => messages.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("harold_events_visitor_id_idx").on(table.visitorId, table.id),
    index("harold_events_visitor_created_at_idx").on(
      table.visitorId,
      table.createdAt,
    ),
  ],
);

export type Run = typeof runs.$inferSelect;
export type NewRun = typeof runs.$inferInsert;
export type Memory = typeof memory.$inferSelect;
export type NewMemory = typeof memory.$inferInsert;
export type HaroldState = typeof haroldState.$inferSelect;
export type NewHaroldState = typeof haroldState.$inferInsert;
export type MessageReaction = typeof messageReactions.$inferSelect;
export type NewMessageReaction = typeof messageReactions.$inferInsert;
export type HaroldEvent = typeof haroldEvents.$inferSelect;
export type NewHaroldEvent = typeof haroldEvents.$inferInsert;
