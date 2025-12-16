import { NextRequest, NextResponse } from "next/server";
import {
  fetchOpenRouterModels,
  OPENROUTER_DEFAULT_BASE_URL,
} from "@/app/lib/openrouter";

export async function POST(request: NextRequest) {
  try {
    // Backwards-compatible route name: now returns OpenRouter models.
    const models = await fetchOpenRouterModels();
    return NextResponse.json({ baseUrl: OPENROUTER_DEFAULT_BASE_URL, models });
  } catch (error) {
    return NextResponse.json(
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
