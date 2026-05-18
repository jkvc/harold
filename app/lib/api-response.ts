import { NextResponse } from "next/server";
import type { ApiErrorCode, ApiResponse } from "@/app/lib/api-types";

export function successResponse<T>(data: T, init?: ResponseInit) {
  return NextResponse.json<ApiResponse<T>>({ success: true, data }, init);
}

export function errorResponse(
  status: number,
  error: string,
  code?: ApiErrorCode,
) {
  return NextResponse.json<ApiResponse<never>>(
    { success: false, error, code },
    { status },
  );
}
