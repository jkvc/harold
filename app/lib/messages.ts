import type { Message, MessageReaction } from "@/app/lib/db/schema";

export type MessageReactionDto = Omit<MessageReaction, "createdAt"> & {
  createdAt: string;
};

export type MessageDto = Omit<Message, "createdAt"> & {
  createdAt: string;
  reactions: MessageReactionDto[];
};

export type MessagePageDto = {
  messages: MessageDto[];
  hasMore: boolean;
};

export function serializeReaction(reaction: MessageReaction): MessageReactionDto {
  return {
    ...reaction,
    createdAt: reaction.createdAt.toISOString(),
  };
}

export function serializeMessage(
  message: Message,
  reactions: MessageReaction[] = [],
): MessageDto {
  return {
    ...message,
    createdAt: message.createdAt.toISOString(),
    reactions: reactions.map(serializeReaction),
  };
}

export function serializeMessagesWithReactions(
  messages: Message[],
  reactions: MessageReaction[],
): MessageDto[] {
  const reactionsByMessageId = new Map<string, MessageReaction[]>();

  for (const reaction of reactions) {
    const groupedReactions = reactionsByMessageId.get(reaction.messageId) ?? [];
    groupedReactions.push(reaction);
    reactionsByMessageId.set(reaction.messageId, groupedReactions);
  }

  return messages.map((message) =>
    serializeMessage(message, reactionsByMessageId.get(message.id) ?? []),
  );
}
