CREATE TABLE "runs" (
	"id" text PRIMARY KEY NOT NULL,
	"visitor_id" text NOT NULL,
	"turn_messages" jsonb,
	"status" text DEFAULT 'running' NOT NULL,
	"model" text,
	"bounce_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "runs_status_check" CHECK ("runs"."status" in ('running', 'completed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "memory" (
	"id" text PRIMARY KEY NOT NULL,
	"visitor_id" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "harold_state" (
	"visitor_id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'sleeping' NOT NULL,
	"active_run_id" text,
	"last_processed_at" timestamp with time zone,
	"last_processed_message_id" text,
	"pending_wake_requested_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "harold_state_status_check" CHECK ("harold_state"."status" in ('sleeping', 'working'))
);
--> statement-breakpoint
CREATE TABLE "message_reactions" (
	"id" text PRIMARY KEY NOT NULL,
	"visitor_id" text NOT NULL,
	"message_id" text NOT NULL,
	"actor" text NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_reactions_actor_check" CHECK ("message_reactions"."actor" in ('harold', 'user'))
);
--> statement-breakpoint
CREATE TABLE "harold_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"visitor_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"run_id" text,
	"message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "harold_state" ADD CONSTRAINT "harold_state_active_run_id_runs_id_fk" FOREIGN KEY ("active_run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "harold_state" ADD CONSTRAINT "harold_state_last_processed_message_id_messages_id_fk" FOREIGN KEY ("last_processed_message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "harold_events" ADD CONSTRAINT "harold_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "harold_events" ADD CONSTRAINT "harold_events_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "runs_visitor_created_at_idx" ON "runs" USING btree ("visitor_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "memory_visitor_id_unique" ON "memory" USING btree ("visitor_id");
--> statement-breakpoint
CREATE INDEX "harold_state_status_updated_at_idx" ON "harold_state" USING btree ("status","updated_at");
--> statement-breakpoint
CREATE INDEX "message_reactions_visitor_created_at_idx" ON "message_reactions" USING btree ("visitor_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "message_reactions_message_actor_emoji_unique" ON "message_reactions" USING btree ("message_id","actor","emoji");
--> statement-breakpoint
CREATE INDEX "harold_events_visitor_id_idx" ON "harold_events" USING btree ("visitor_id","id");
--> statement-breakpoint
CREATE INDEX "harold_events_visitor_created_at_idx" ON "harold_events" USING btree ("visitor_id","created_at");
