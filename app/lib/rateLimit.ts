type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterMs: number; reason: "requests" | "tokens" };

type Bucket = {
  windowStartMs: number;
  requests: number;
  tokens: number;
};

const getOrCreateStore = () => {
  const globalAny = globalThis as unknown as {
    __llmChessRateLimitStore?: Map<string, Bucket>;
  };

  if (!globalAny.__llmChessRateLimitStore) {
    globalAny.__llmChessRateLimitStore = new Map<string, Bucket>();
  }

  return globalAny.__llmChessRateLimitStore;
};

const clampInt = (value: unknown, fallback: number) => {
  const asNumber = typeof value === "string" ? Number(value) : Number(value);
  if (!Number.isFinite(asNumber)) return fallback;
  return Math.max(1, Math.floor(asNumber));
};

export const estimateTokensForText = (text: string) => {
  // Rough heuristic: ~4 chars per token for English-ish text.
  const chars = typeof text === "string" ? text.length : 0;
  return Math.max(1, Math.ceil(chars / 4));
};

export const estimateTokensForMessages = (messages: Array<{ content: string }>) =>
  messages.reduce((sum, msg) => sum + estimateTokensForText(msg.content), 0);

export const getOpenRouterRateLimitConfig = () => {
  // Profiles (override any of these via env):
  // - smooth:         RPM=80, TPM=60000
  // - cost-controlled: RPM=60, TPM=25000
  const profileRaw = process.env.OPENROUTER_RATE_LIMIT_PROFILE?.trim().toLowerCase();
  const profile = profileRaw === "cost-controlled" || profileRaw === "cost_controlled"
    ? "cost-controlled"
    : "smooth";

  const defaults =
    profile === "cost-controlled"
      ? { maxRequestsPerMinute: 60, maxEstimatedTokensPerMinute: 25_000 }
      : { maxRequestsPerMinute: 80, maxEstimatedTokensPerMinute: 60_000 };

  const maxRequestsPerMinute = clampInt(process.env.OPENROUTER_MAX_RPM, defaults.maxRequestsPerMinute);
  const maxEstimatedTokensPerMinute = clampInt(
    process.env.OPENROUTER_MAX_TPM,
    defaults.maxEstimatedTokensPerMinute
  );
  return { maxRequestsPerMinute, maxEstimatedTokensPerMinute };
};

export const consumeRateLimit = (params: {
  key: string;
  tokensToConsume: number;
  windowMs?: number;
  maxRequestsPerWindow: number;
  maxTokensPerWindow: number;
}): RateLimitResult => {
  const windowMs = params.windowMs ?? 60_000;
  const now = Date.now();
  const store = getOrCreateStore();

  const existing = store.get(params.key);
  const bucket: Bucket = existing
    ? existing
    : { windowStartMs: now, requests: 0, tokens: 0 };

  const elapsed = now - bucket.windowStartMs;
  if (elapsed >= windowMs) {
    bucket.windowStartMs = now;
    bucket.requests = 0;
    bucket.tokens = 0;
  }

  const nextRequests = bucket.requests + 1;
  if (nextRequests > params.maxRequestsPerWindow) {
    const retryAfterMs = Math.max(0, windowMs - (now - bucket.windowStartMs));
    store.set(params.key, bucket);
    return { allowed: false, retryAfterMs, reason: "requests" };
  }

  const tokensToConsume = Math.max(1, Math.floor(params.tokensToConsume));
  const nextTokens = bucket.tokens + tokensToConsume;
  if (nextTokens > params.maxTokensPerWindow) {
    const retryAfterMs = Math.max(0, windowMs - (now - bucket.windowStartMs));
    store.set(params.key, bucket);
    return { allowed: false, retryAfterMs, reason: "tokens" };
  }

  bucket.requests = nextRequests;
  bucket.tokens = nextTokens;
  store.set(params.key, bucket);
  return { allowed: true };
};


