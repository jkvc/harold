export type ApiErrorCode =
  | "BAD_REQUEST"
  | "DB_UNAVAILABLE"
  | "EMPTY_MESSAGE"
  | "MISSING_VISITOR";

export type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: ApiErrorCode };
