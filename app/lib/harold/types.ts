import type { MessageDto, MessageReactionDto } from "@/app/lib/messages";

export type HaroldStatus = "sleeping" | "working";

export type HaroldEventPayload =
  | {
      type: "message";
      message: MessageDto;
    }
  | {
      type: "assistant_text";
      text: string;
      runId?: string | null;
    }
  | {
      type: "assistant_thinking";
      text: string;
      runId?: string | null;
    }
  | {
      type: "reaction";
      reaction: MessageReactionDto;
    }
  | {
      type: "tool_start";
      id: string;
      name: string;
      input: Record<string, unknown>;
      runId?: string | null;
    }
  | {
      type: "tool_complete";
      id: string;
      name: string;
      result: unknown;
      runId?: string | null;
    }
  | {
      type: "memory_updated";
      runId?: string | null;
    }
  | {
      type: "run_start";
      runId: string;
      model: string;
    }
  | {
      type: "run_end";
      runId: string;
      status: "completed" | "failed";
      error?: string;
    }
  | {
      type: "error";
      message: string;
      runId?: string | null;
    };

export type HaroldSseEvent = HaroldEventPayload & {
  eventId: number;
  visitorId: string;
  createdAt: string;
};

export type DebugEventDto = {
  id: number;
  visitorId: string;
  eventType: HaroldEventPayload["type"];
  payload: HaroldEventPayload;
  runId: string | null;
  messageId: string | null;
  createdAt: string;
};

export type DebugEventPageDto = {
  events: DebugEventDto[];
  hasMore: boolean;
  lastId: number | null;
};
