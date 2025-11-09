import { NextRequest, NextResponse } from "next/server";

const normalizeBaseUrl = (raw: string) => raw.trim().replace(/\/$/, "");

const extractModels = (payload: unknown): Array<{
  id: string;
  label?: string;
  provider?: string | null;
}> => {
  if (!payload || typeof payload !== "object") return [];

  const data = (payload as { data?: unknown; models?: unknown }).data;
  const modelsRaw: unknown[] = Array.isArray(data)
    ? data
    : Array.isArray((payload as { models?: unknown }).models)
      ? ((payload as { models?: unknown[] }).models ?? [])
      : [];

  return modelsRaw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const candidate = entry as {
        id?: string;
        name?: string;
        model?: string;
        provider?: string;
        owned_by?: string;
        description?: string;
      };

      const id = candidate.id || candidate.model || candidate.name;
      if (!id) return null;

      return {
        id,
        label: candidate.name || candidate.description || candidate.id || candidate.model,
        provider: candidate.provider || candidate.owned_by || null,
      };
    })
    .filter((entry): entry is { id: string; label?: string; provider?: string | null } => Boolean(entry));
};

export async function POST(request: NextRequest) {
  let payload: { baseUrl?: string; apiKey?: string } = {};

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON payload." },
      { status: 400 }
    );
  }

  const { baseUrl, apiKey } = payload;
  if (!baseUrl || typeof baseUrl !== "string") {
    return NextResponse.json(
      { error: "baseUrl is required." },
      { status: 400 }
    );
  }

  const normalizedBase = normalizeBaseUrl(baseUrl);
  const endpoint = `${normalizedBase}/v1/models`;

  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
    headers["x-api-key"] = apiKey;
  }

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers,
    });

    if (!response.ok) {
      const message = (await response.text()).slice(0, 500);
      return NextResponse.json(
        {
          error: `LiteLLM responded with ${response.status}. ${message}`,
        },
        { status: response.status }
      );
    }

    const data = await response.json();
    const models = extractModels(data);

    return NextResponse.json({ baseUrl: normalizedBase, models });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? `LiteLLM request failed: ${error.message}`
            : "LiteLLM request failed.",
      },
      { status: 500 }
    );
  }
}
