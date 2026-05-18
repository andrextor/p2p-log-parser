# @p2p/log-parser

Single-package TypeScript library for parsing Placetopay application logs (AWS CloudWatch CSV, New Relic JSON, Laravel local logs).

## Commands

| Command | What it does |
|---|---|
| `pnpm run lint` | `biome check .` (linter ignores `test/**`) |
| `pnpm run format` | `biome format --write .` |
| `pnpm run test:run` | `vitest run` (single run) |
| `pnpm test` | `vitest` (watch mode) |
| `pnpm run build` | `tsc && vite build` (typecheck **before** bundle) |

Run a single test: `pnpm vitest run test/unit/checkout/mappers/CheckoutMapper.test.ts`

CI order: `lint → test:run → build`.

## Architecture: three-stage pipeline

The engine (`src/engine.ts:112`) processes each log line through a fixed pipeline:

```
raw text → sanitize → splitLogicalUnits →
  for each unit:
    1. Strategy.parse(unit) → NormalizedLogData | null   (first non-null strategy wins)
    2. Mapper.canHandle(data) → Mapper.map(data) → LogEvent
    3. Errors caught → ParseResult.errors[]
→ sort chronologically → group by session → extract metadata
```

**Strategies** detect the log format. **Mappers** classify and label the event. **Metadata extractors** produce session/site summaries.

## Key structure

- **Entrypoint**: `src/index.ts` re-exports `P2PParserEngine` + public types
- **Engine**: `src/engine.ts` — orchestrator, owns the strategy/mapper/extractor registries
- **3 domain modules**: `src/checkout/`, `src/rest/`, `src/microsites/`
  - `strategies/` — format detectors (return `NormalizedLogData` or `null`)
  - `mappers/` — event classifiers (implement `LogMapper`: `canHandle`, `map`, `isMatch`)
  - `metadata/` — session/operation summaries (return domain metadata or `undefined` when data is insufficient)
  - `constants/` — action maps (checkout + rest only; microsites has none)
- **Shared**: `src/common/strategies/LogExtractionStrategy.ts`, `src/common/mappers/BaseMapper.ts`, `src/common/metadata/MetadataExtractor.ts`
- Tests: `test/unit/`, `test/feature/`, `test/fixtures/sample.csv` — no external services

## Path aliases

Available in both `tsconfig.json` and `vite.config.ts` (also in vitest via merge):

| Alias | Maps to |
|---|---|
| `@/` | `src/` |
| `@checkout/` | `src/checkout/` |
| `@rest/` | `src/rest/` |
| `@common/` | `src/common/` |
| `@types/` | `src/types/` |
| `@utils/` | `src/utils/` |
| `@test/` | `test/` |

Import style is **inconsistent** across files — some use aliases, some use relative. Match the convention of the file you're editing.

## Strategy rules (when creating or modifying a parser)

1. **Noise filter first** — check if the line matches the format; return `null` early if not.
2. **Extract JSON payload** — find the structured data within the line (regex, marker strings, bracket tracking).
3. **Normalize escaped quotes** — CSV-exported JSON may double-escape: `""text""`.
4. **Assign a unique `sourceType`** — e.g. `"AWS_CSV"`, `"GRAFANA_CSV"`, `"GRAFANA_JSON"`, `"LARAVEL_LOCAL"`, `"NEW_RELIC_JSON"`.
5. **Wrap in try/catch** — return `null` on any parse error (never throw).
6. **Expose `getMetadata()`** — return `{ name, description, detectionRule }`.
7. Register the strategy in `src/engine.ts:69-79`.

## Mapper rules

- `canHandle(data)` — domain gate. Check `sourceType`, context keys (`session_id`, `TENANT_DOMAIN`), or message content.
- `map(data, rawLine, index)` — main transform. Look up the action in the action map; detect special patterns (gateway logs, DB ops, 3DS, validation errors); return `LogEvent` with correct `appType`.
- Both `CheckoutMapper` and `RestMapper` accept an optional custom action map in their constructor.
- `GenericMapper` is the fallback (always returns `true` from `canHandle`).

## Action maps

- `src/checkout/constants/CheckoutActions.ts` — ~18 entries; `CheckoutActionDetail { message, category, source: "FRONTEND" | "BACKEND" }`
- `src/rest/constants/RestActions.ts` — ~7 entries; `RestActionDetail` (source always `"BACKEND"`)
- `mergeCheckoutActions` / `mergeRestActions` — shallow spread: `{ ...DEFAULT_MAP, ...custom }`. Existing keys are overridden; new keys are added.

## Metadata extractors

- Return domain-specific metadata when there is **enough data**, otherwise `undefined`.
- `CheckoutMetadataExtractor` returns `undefined` if fewer than 2 sessions found.
- Session types: `"PAYMENT" | "SUBSCRIPTION" | "AUTOPAY" | "UNKNOWN"` — detected from `request.body` payload markers.
- For `AppTypes.ALL`, metadata extractors are tried in priority: CHECKOUT → REST → MICROSITES.

## Test conventions

- Vitest with `globals: true` — `describe`, `it`, `expect` **do not need imports**.
- Unit tests construct `NormalizedLogData` objects **inline** (no stub files).
- Mapper tests: instantiate mapper once in `describe`, call `mapper.map(logData, "", index)` per test.
- Strategy tests: call `parser.parse(line)`, guard with `expect(result).not.toBeNull()`.
- Feature tests: read `test/fixtures/sample.csv` via `fs.readFileSync`, call `engine.parse(csv, AppTypes.CHECKOUT)`.
- The file `test/scripts/test_mapper.ts` is a manual smoke-test script, not part of the test suite.

## Important quirks

- **Package manager is `pnpm`** (v9 in CI), not npm. Lockfile: `pnpm-lock.yaml`.
- Biome linter skips `test/**` — test files are **not linted** (only formatted).
- `build` runs `tsc` first (`noEmit: true`, strict) then `vite build` (library mode → `dist/p2p-log-parser.{js,cjs}`).
- TS strictness: `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns` are all enforced at compile time.
- Published as `@andrextor_ia11012/p2p-log-parser`; only `dist/` is shipped (`"files": ["dist"]`).
- CI auto-publishes npm + creates GitHub release on push to `main` when the version tag does not yet exist.
