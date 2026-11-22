type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterMs: number; reason: "requests" | "tokens" };

type Bucket = {
  windowStartMs: number;
  requests: number;
  tokens: number;
};

const MAX_KEYS = 5_000;

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

const evictOldestIfNeeded = (store: Map<string, Bucket>) => {
  while (store.size > MAX_KEYS) {
    const oldestKey = store.keys().next().value;
    if (oldestKey === undefined) break;
    store.delete(oldestKey);
  }
};

export const estimateTokensForText = (text: string) => {
  // ASCII ~4 chars/token; non-ASCII (e.g. CJK) closer to 1 token/char.
  if (typeof text !== "string" || text.length === 0) return 1;
  let ascii = 0;
  let other = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) < 128) ascii += 1;
    else other += 1;
  }
  return Math.max(1, Math.ceil(ascii / 4) + other);
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
    ? { ...existing }
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
    // Do not create a brand-new bucket on deny; only refresh existing ones.
    if (existing) {
      store.delete(params.key);
      store.set(params.key, existing);
      evictOldestIfNeeded(store);
    }
    return { allowed: false, retryAfterMs, reason: "requests" };
  }

  const tokensToConsume = Math.max(1, Math.floor(params.tokensToConsume));
  const nextTokens = bucket.tokens + tokensToConsume;
  if (nextTokens > params.maxTokensPerWindow) {
    const retryAfterMs = Math.max(0, windowMs - (now - bucket.windowStartMs));
    if (existing) {
      store.delete(params.key);
      store.set(params.key, existing);
      evictOldestIfNeeded(store);
    }
    return { allowed: false, retryAfterMs, reason: "tokens" };
  }

  bucket.requests = nextRequests;
  bucket.tokens = nextTokens;
  // Re-insert so the key becomes newest in Map insertion order (for LRU eviction).
  store.delete(params.key);
  store.set(params.key, bucket);
  evictOldestIfNeeded(store);
  return { allowed: true };
};
