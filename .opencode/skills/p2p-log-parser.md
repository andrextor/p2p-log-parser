---
name: p2p-log-parser
description: Guide for working on the @p2p/log-parser TypeScript library. Use when adding parsers, mappers, or metadata extractors, modifying the engine pipeline, writing tests, or debugging log parsing issues.
trigger: always_on
---

# @p2p/log-parser — Developer Guide

Single-package TypeScript library for parsing Placetopay application logs from multiple sources (AWS CloudWatch CSV, New Relic JSON, Laravel local logs).

## Package manager

**pnpm** (v9 in CI), not npm. Commands:

| Command | What it does |
|---|---|
| `pnpm run lint` | `biome check .` |
| `pnpm run format` | `biome format --write .` |
| `pnpm test:run` | `vitest run` (single run) |
| `pnpm test` | `vitest` (watch mode) |
| `pnpm run build` | `tsc && vite build` |

Run a single test: `pnpm vitest run test/unit/checkout/mappers/CheckoutMapper.test.ts`

## Architecture: three-stage pipeline

```
raw text → sanitize → splitLogicalUnits →
  for each unit:
    1. Strategy.parse(unit) → NormalizedLogData | null   (first non-null strategy wins)
    2. Mapper.canHandle(data) → Mapper.map(data) → LogEvent
    3. Errors caught → ParseResult.errors[]
→ sort chronologically → group by session → extract metadata
```

- **Strategies** detect the log format and extract structured data.
- **Mappers** classify each event (category, message, source) and produce `LogEvent`.
- **Metadata extractors** summarize multi-event data into session/site reports.

## Creating a new strategy (parser)

1. **Noise filter first** — return `null` early if the line doesn't match your format.
2. **Extract the JSON payload** — use regex, marker strings (`,"{`), or bracket tracking.
3. **Normalize escaped quotes** — CSV exports double-escape: `""text""`.
4. **Assign a unique `sourceType`** — e.g. `"AWS_CSV"`, `"NEW_RELIC_JSON"`.
5. **Wrap in try/catch** — return `null` on any parse error, never throw.
6. **Implement `getMetadata()`** — return `{ name, description, detectionRule }`.
7. **Register it** in `src/engine.ts:69-79` under the correct `AppType`.

## Creating or modifying a mapper

- `canHandle(data)` — check `sourceType`, context keys (`session_id`, `TENANT_DOMAIN`), message content.
- `map(data, rawLine, index)` — look up the action in the action map; detect special patterns (gateway `[GW_LIB]`, DB ops, 3DS lightbox, validation errors); return `LogEvent` with correct `appType`.
- Both `CheckoutMapper` and `RestMapper` accept an optional custom action map in their constructor.
- `GenericMapper` is the fallback, always returns `true` from `canHandle`.

## Action maps

- `src/checkout/constants/CheckoutActions.ts` — `CheckoutActionDetail { message, category, source: "FRONTEND" | "BACKEND" }`
- `src/rest/constants/RestActions.ts` — `RestActionDetail` (source always `"BACKEND"`)
- Merge: `{ ...DEFAULT_MAP, ...custom }` — existing keys are overridden, new keys are added.

## Metadata extractors

- Return domain metadata or `undefined` if data is insufficient.
- `CheckoutMetadataExtractor` returns `undefined` if fewer than 2 sessions.
- Session types: `"PAYMENT" | "SUBSCRIPTION" | "AUTOPAY" | "UNKNOWN"`, detected from `request.body` payload.
- For `AppTypes.ALL`, extractors are tried: CHECKOUT → REST → MICROSITES.

## Testing patterns

- Vitest `globals: true` — no imports for `describe`, `it`, `expect`.
- Construct `NormalizedLogData` objects **inline** in tests (no fixtures).
- Mapper tests: instantiate mapper once, call `mapper.map(logData, "", index)` per test.
- Strategy tests: call `parser.parse(line)`, assert with `expect(result).not.toBeNull()`.
- Feature tests: read `test/fixtures/sample.csv` via `fs.readFileSync`.

## Path aliases

| Alias | Maps to |
|---|---|
| `@/` | `src/` |
| `@checkout/` | `src/checkout/` |
| `@rest/` | `src/rest/` |
| `@common/` | `src/common/` |
| `@types/` | `src/types/` |
| `@utils/` | `src/utils/` |
| `@test/` | `test/` |

Import style is inconsistent — match the convention of the file you're editing.

## Important quirks

- Biome **skips test files** entirely (`test/**` in ignore list). Test files won't be linted.
- `build` runs `tsc` first (type-check only, `noEmit: true`) then `vite build`. Type failures block the build.
- TS strict: `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns` all enforced.
- Only `dist/` is shipped to npm. The `src/` directory is excluded from the published package.
- CI auto-publishes npm + creates GitHub release on push to `main` when the version tag does not yet exist.
