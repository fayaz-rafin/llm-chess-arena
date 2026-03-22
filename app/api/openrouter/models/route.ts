import { NextRequest, NextResponse } from "next/server";
import {
  fetchOpenRouterModels,
  OPENROUTER_DEFAULT_BASE_URL,
} from "@/app/lib/openrouter";

export const dynamic = "force-dynamic";

const noStoreJson = (body: unknown, init?: { status?: number }) =>
  NextResponse.json(body, {
    ...init,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });

export async function GET() {
  try {
    const models = await fetchOpenRouterModels();
    return noStoreJson({ baseUrl: OPENROUTER_DEFAULT_BASE_URL, models });
  } catch (error) {
    return noStoreJson(
      {
        error:
          error instanceof Error
            ? `OpenRouter request failed: ${error.message}`
            : "OpenRouter request failed.",
      },
      { status: 500 }
    );
  }
}

export async function POST(_request: NextRequest) {
  try {
    const models = await fetchOpenRouterModels();
    return noStoreJson({ baseUrl: OPENROUTER_DEFAULT_BASE_URL, models });
  } catch (error) {
    return noStoreJson(
      {
        error:
          error instanceof Error
            ? `OpenRouter request failed: ${error.message}`
            : "OpenRouter request failed.",
      },
      { status: 500 }
    );
  }
}
