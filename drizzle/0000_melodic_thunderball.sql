CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"visitor_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"reply_to_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "messages_visitor_created_at_idx" ON "messages" USING btree ("visitor_id","created_at");