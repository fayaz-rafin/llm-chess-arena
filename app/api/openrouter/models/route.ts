import { NextRequest, NextResponse } from "next/server";
import { getAllowedModels, resolveClientId } from "@/app/lib/allowedModels";
import {
  fetchOpenRouterModels,
  OPENROUTER_DEFAULT_BASE_URL,
} from "@/app/lib/openrouter";
import { consumeRateLimit } from "@/app/lib/rateLimit";

export const revalidate = 300;

const MODELS_MAX_REQUESTS_PER_MINUTE = 30;

const cachedJson = (body: unknown, init?: { status?: number }) =>
  NextResponse.json(body, {
    ...init,
    headers: {
      "Cache-Control":
        init?.status && init.status >= 400
          ? "no-store, max-age=0"
          : "public, s-maxage=300, stale-while-revalidate=60",
    },
  });

const loadAllowedModels = async () => {
  const allowed = getAllowedModels();
  const models = await fetchOpenRouterModels();
  const filtered = models.filter((model) => allowed.has(model.id));

  // Always surface the operator allowlist even if OpenRouter omits an entry.
  const seen = new Set(filtered.map((model) => model.id));
  for (const id of allowed) {
    if (seen.has(id)) continue;
    const provider = id.includes("/") ? id.split("/")[0] : null;
    filtered.push({ id, label: id, provider });
  }

  filtered.sort((a, b) => {
    const aKey = [a.provider, a.label || a.id].filter(Boolean).join(" · ");
    const bKey = [b.provider, b.label || b.id].filter(Boolean).join(" · ");
    const byLabel = aKey.localeCompare(bKey, undefined, { sensitivity: "base" });
    if (byLabel !== 0) return byLabel;
    return a.id.toLowerCase().localeCompare(b.id.toLowerCase());
  });

  return filtered;
};

const handleModelsRequest = async (request: NextRequest) => {
  const clientId = resolveClientId(request);
  const limitResult = consumeRateLimit({
    key: `models:${clientId}`,
    tokensToConsume: 1,
    maxRequestsPerWindow: MODELS_MAX_REQUESTS_PER_MINUTE,
    maxTokensPerWindow: MODELS_MAX_REQUESTS_PER_MINUTE,
  });

  if (!limitResult.allowed) {
    return cachedJson(
      { error: "Too many model list requests. Try again shortly." },
      { status: 429 }
    );
  }

  try {
    const models = await loadAllowedModels();
    return cachedJson({ baseUrl: OPENROUTER_DEFAULT_BASE_URL, models });
  } catch (error) {
    console.warn("OpenRouter models route error", error);
    return cachedJson(
      { error: "Failed to load models" },
      { status: 500 }
    );
  }
};

export async function GET(request: NextRequest) {
  return handleModelsRequest(request);
}

export async function POST(request: NextRequest) {
  return handleModelsRequest(request);
}
