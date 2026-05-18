export const VISITOR_COOKIE_NAME = "harold_visitor_id";
export const VISITOR_STORAGE_KEY = "harold.visitorId";
export const VISITOR_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

const VISITOR_ID_PREFIX = "visitor";

export function generateVisitorId(): string {
  return `${VISITOR_ID_PREFIX}_${crypto.randomUUID()}`;
}

export function isValidVisitorId(value: string | undefined | null): value is string {
  return typeof value === "string" && /^visitor_[0-9a-f-]{36}$/.test(value);
}

export function readVisitorCookie(cookieHeader: string): string | null {
  const cookies = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);

  for (const cookie of cookies) {
    const [name, ...valueParts] = cookie.split("=");
    if (name === VISITOR_COOKIE_NAME) {
      const value = safeDecodeCookieValue(valueParts.join("="));
      return isValidVisitorId(value) ? value : null;
    }
  }

  return null;
}

function safeDecodeCookieValue(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function writeVisitorCookie(visitorId: string): void {
  document.cookie = `${VISITOR_COOKIE_NAME}=${encodeURIComponent(
    visitorId,
  )}; path=/; max-age=${VISITOR_COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
}

export function readStoredVisitorId(): string | null {
  const storedVisitorId = window.localStorage.getItem(VISITOR_STORAGE_KEY);
  return isValidVisitorId(storedVisitorId) ? storedVisitorId : null;
}

export function storeVisitorId(visitorId: string): void {
  window.localStorage.setItem(VISITOR_STORAGE_KEY, visitorId);
  writeVisitorCookie(visitorId);
}

export function ensureVisitorId(): string {
  const existingVisitorId =
    readStoredVisitorId() ?? readVisitorCookie(document.cookie);
  const visitorId = existingVisitorId ?? generateVisitorId();

  storeVisitorId(visitorId);

  return visitorId;
}
