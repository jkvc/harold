import { Client, Receiver } from "@upstash/qstash";
import { getBaseUrl } from "@/app/lib/base-url";

let client: Client | null = null;
let receiver: Receiver | null = null;

type DispatchWakeParams = {
  visitorId: string;
  model?: string;
};

export async function dispatchWake({
  visitorId,
  model,
}: DispatchWakeParams): Promise<{ success: boolean; error?: string }> {
  const url = `${getBaseUrl()}/api/wake/run`;
  const body = {
    visitorId,
    model,
  };

  const forwardHeaders: Record<string, string> = {};
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    forwardHeaders["x-vercel-protection-bypass"] =
      process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  }

  if (!process.env.VERCEL) {
    const result = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-harold-local-wake": "1",
        ...forwardHeaders,
      },
      body: JSON.stringify(body),
    });

    if (!result.ok) {
      return { success: false, error: await result.text() };
    }

    return { success: true };
  }

  try {
    await getQstashClient().publishJSON({
      url,
      body,
      headers: forwardHeaders,
      retries: 2,
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function verifyQstashRequest(request: Request, body: string) {
  if (!process.env.VERCEL) {
    return request.headers.get("x-harold-local-wake") === "1";
  }

  return getQstashReceiver().verify({
    signature: request.headers.get("upstash-signature") ?? "",
    body,
    url: request.url,
  });
}

function getQstashClient() {
  if (!process.env.QSTASH_TOKEN) {
    throw new Error("QSTASH_TOKEN is required");
  }

  if (!client) {
    client = new Client({ token: process.env.QSTASH_TOKEN });
  }

  return client;
}

function getQstashReceiver() {
  if (!process.env.QSTASH_CURRENT_SIGNING_KEY) {
    throw new Error("QSTASH_CURRENT_SIGNING_KEY is required");
  }

  if (!process.env.QSTASH_NEXT_SIGNING_KEY) {
    throw new Error("QSTASH_NEXT_SIGNING_KEY is required");
  }

  if (!receiver) {
    receiver = new Receiver({
      currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
      nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY,
    });
  }

  return receiver;
}
