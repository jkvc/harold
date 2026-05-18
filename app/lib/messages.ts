import type { Message } from "@/app/lib/db/schema";

export type MessageDto = Omit<Message, "createdAt"> & {
  createdAt: string;
};

export type MessagePageDto = {
  messages: MessageDto[];
  hasMore: boolean;
};

export function serializeMessage(message: Message): MessageDto {
  return {
    ...message,
    createdAt: message.createdAt.toISOString(),
  };
}
