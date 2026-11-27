# Yayın Altyazı

Live Turkish subtitles for console game streams (GTA 6 first). The streamer adds `/o/<token>` to OBS as a Browser Source. That page talks to OBS's built-in obs-websocket on `ws://127.0.0.1:4455`, grabs frames from the capture card source, OCRs the English subtitle area with Tesseract (WASM, in the browser), sends each new line to the server, and draws the Turkish line on top of the game. See README.md for setup and configuration.

## Stack

- TanStack Start (Vite, React 19, TypeScript), shadcn/ui on Base UI, Tailwind 4, oxlint. pnpm.
- Better Auth (email + password) with the Drizzle adapter. Postgres in production, PGlite on disk (`.data/pglite`) when `DATABASE_URL` is unset. `SIGNUP=closed` turns off sign-up.
- Translation: Claude Haiku (`CLAUDE_MODEL`, default `claude-haiku-5-5`) through `ANTHROPIC_API_KEY`, with an optional `ANTHROPIC_API_KEY_PRIMARY` that serves first while `ANTHROPIC_API_KEY` takes over when it is rate limited, out of credit or failing (sticky rest periods, `src/server/claude.ts`). Without a Claude key it uses an OpenAI-compatible `AI_BASE_URL`/`AI_API_KEY`/`AI_MODEL`. A call still running after 1.5 s gets a second, identical call and the first answer wins (`hedged` in `llm.ts`). Streaming doesn't help: Haiku sends a token early, then the rest of the line in one burst at the end.
- Optional billing through Polar (`@polar-sh/better-auth`), on only when `POLAR_ACCESS_TOKEN` and `POLAR_PRODUCT` are set (`src/server/plan.ts`). Off means every account is `plan: "open"` with no limits, and the dashboard hides plan UI. The webhook goes to `/api/auth/polar/webhooks` with `subscription.*` events. The Polar customer is created at checkout, not at sign-up.
- Nitro `node-server` output and a Dockerfile.

## Layout

- `src/engine/`: frame sources (OBS, video), preprocessing, Tesseract wrapper, `SubtitleReader`. Browser only. Assets are self-hosted in `public/tesseract/` (`pnpm assets:tesseract`).
  - Ink detection is adaptive (`ADAPTIVE` in `preprocess.ts`): a loose pass finds the text, the ink's real brightness is measured, and a second pass runs with the threshold 80 below it. GTA 6 draws thin light-gray text without an outline, which a fixed threshold drops.
  - Text is split into blocks: dialogue, and the bold mission objective line under it (`classifyBlocks`, stroke weight plus position; the reader also learns where objectives sit so fading ones stay objectives). Each kind is its own track and its own line on stream (`style.objectives`).
  - The reader reports a line's first read as provisional (`onProvisional`); the overlay posts it with `provisional: true`, the server starts translating without metering or showing it, and the confirmed post picks up the same translation.
- `scripts/ocr-bench/`: OCR benchmark on real gameplay footage (`fetch.sh` downloads it, `segment.mts` builds the dialogue set, `dialogue.mts` and `objectives.mts` score the engine against hand-written expected text kept outside git). Run it before and after any change to `src/engine/`.
- `scripts/prefill/`: pre-fills the shared cache from playthrough footage. `fetch.sh`/`chunk.mts`/`extract.mts` run the real `SubtitleReader` over the video (default region, 5 fps, 1920 wide), `build-lines.mts` writes `lines.jsonl` (gitignored) with the context the server would send, and `translate.mts` sends each line through `translateLine` (same prompt, sanitizer and cache write) under a `--budget-usd` cap, resumable from `state.local`. Objective lines that read like dialogue are skipped (the engine misfiles some on small fonts).
- `src/server/`: DB schema and connection, auth, billing sync, plan config (`plan.ts`), entitlement and metering (`overlay.ts`), translation with a shared cache (`translate.ts`, `llm.ts`), SSE hub for the phone view (`hub.ts`), game glossaries.
  - Each dialogue line goes to the model with the last 8 lines of the last 2 minutes as context. Lines that continue the previous card's sentence skip the shared cache. Replies are checked (`sanitizeTranslation`) and dropped if they comment on the input instead of translating it.
  - Cache lookups: exact key first, then a near miss through `pg_trgm` (`closeEnough` in `translate.ts`): lines of 4+ words that differ only by split/merged words and look-alike letters, or by 1-2 letters in long lines, never by digits, negation or short meaningful words ("he"/"she"). A near hit is saved under the new spelling too (`model = "alias:<key>"`). PGlite loads the `pg_trgm` contrib extension in dev.
- `src/routes/`: `/` landing, `/giris` auth, `/panel` dashboard, `/o/$token` OBS overlay, `/v/$viewToken` phone/second-screen view, `/api/*` endpoints, `/dev/engine` OCR test harness.
- `src/shared/settings.ts`: overlay settings schema and the `PlanInfo`/`Entitlement` types.
- `drizzle/`: SQL migrations, applied automatically at startup.

## Commands

- `pnpm dev` (port 3000), `pnpm build`, `pnpm typecheck`, `pnpm lint`.
- `pnpm test:e2e` builds and runs the end-to-end suite ([e2e](https://e2e.com), `e2e.config.ts`, `tests/**/*.e2e.ts`). `pnpm exec e2e run [file]` runs against the last build. The runner starts `tests/support/serve.mts`: the built server on a free port with a temp PGlite database and a mock OpenAI-compatible model (`tests/support/translations.mts`), so no key or paid model is involved. Most tests share the `streamer` session from `tests/auth.setup.e2e.ts`; a test that changes the account takes the `newAccount` fixture, which signs up through the API with a random `x-forwarded-for` because sign-up allows 5 accounts per address an hour. `tests/pipeline.e2e.ts` drives the real reader through the overlay's `?demo=` video mode with `tests/fixtures/subtitles.webm`. Failure traces land in `.e2e/results/<test>/trace.md`.
- AI agent tests: `tests/agent.e2e.ts` (tag `agent`). The executor is Claude Code via `@e2e-dev/acp` (`claudeCode({ model: "sonnet" })` in `e2e.config.ts`), using the local `claude` login; through it e2e supports `agent.act` and `agent.assert` only, not `extract` or `waitFor`. Passing `act` steps are recorded in `tests/e2e-cache/` (committed) and replay with no model; CI runs `--strict-cache`, so after a UI change that breaks a recording, rerun `pnpm exec e2e run --tag agent` locally and commit the updated cache files. `agent.assert` always calls the model, so the judge tests skip when `CI` is set. An `act` step's recording is saved only when a locator or engine assertion passes after it.
- `pnpm drizzle-kit generate --name <name>` after schema changes.
- `pnpm dlx tsx scripts/eval-models.ts <model...>` compares translation models (needs `EVAL_API_KEY`).

## Notes

- The overlay runs inside OBS's browser (CEF). It can reach `ws://127.0.0.1` from an https origin. Regular Chrome asks the user for local network access, so the dashboard's OBS connection needs that permission or should be opened as an OBS custom dock.
- Metering (billing on only): a free trial of `TRIAL_MINUTES`, then the paid plan with a monthly cap of `FAIR_USE_MINUTES`. Both count active minutes: a minute counts only when at least one line was delivered in it, and one minute covers up to `LINES_PER_MINUTE` lines (`meterLine`/`chargeMinute` in `overlay.ts`, `usage_day.active_minutes`, `profile.trial_minutes_used`). The 60 s heartbeat only records overlay-open minutes for stats.
- The OBS source must be the capture/game input, not a scene: a scene contains the overlay, so it reads its own Turkish. The panel warns and switches away from scenes, the overlay reports `sourceIsScene`, and both the overlay and `handleLine` drop reads that match recently delivered Turkish (`isOwnText`).
- The "cover" placement draws one opaque box per line exactly over the English text, using the text box the reader reports with each line (`SubtitleLine.box`); the font follows the game's text size, capped by `style.fontSize`.
- The translation prompt sends tagged input (`<previous>`, `<line>`, `<objective>`), not an "EN: … TR:" completion; the completion format made Haiku stutter on lines starting lowercase.
- The overlay reports its state to `/api/overlay/$token/status` every 5 s; the panel's "Canlı durum" shows it (OBS connected, frames, last OCR text, last translation or error). Problems are not drawn on stream except a dead link; add `?debug` to the overlay URL to see them there.
- Security: optional Turnstile on sign-up/sign-in (Better Auth captcha plugin), rate limits keyed on `CLIENT_IP_HEADER` then `x-forwarded-for` (`clientIpHeaders` in `rate-limit.ts`), per-token limits on the overlay API (`src/server/rate-limit.ts`, in memory), a cap on unconfirmed early reads per hour, no framing of `/panel` and `/giris`. `AI_BASE_URL` comes only from the server environment, so it may point at a local model.
- Reliability: the overlay reconnects when OBS drops or grabs keep failing, OCR calls time out after 8 s and get a fresh worker, `/api/health` checks the DB and the translation backend.
- Shared translation cache: only the configured model's replies are written to it. Early reads return no text and at most 3 run per link.
- Game text and footage are copyrighted: never commit videos, frames, transcripts or benchmark expected-text files.
- Keep "GTA" out of the brand and logos. Descriptive use in copy is fine, with the Take-Two disclaimer in the footer.
- UI copy is Turkish. Code, comments and docs are English.
