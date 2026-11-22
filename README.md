# LLM Chess Arena

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

Create a gitignored `.env`:

- `OPENROUTER_API_KEY`
- `OPENROUTER_HTTP_REFERER`, `OPENROUTER_APP_TITLE` (optional)
- `OPENROUTER_RATE_LIMIT_PROFILE` (`smooth` or `cost-controlled`)
- `OPENROUTER_MAX_RPM`
- `OPENROUTER_MAX_TPM`
- `ALLOWED_MODELS` (comma-separated)
- `DATABASE_URL`
