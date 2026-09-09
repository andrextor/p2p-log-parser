# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-09-09

Reescritura del modelo de evento para que el parser entregue la información ya
derivada y los consumidores visuales no tengan que recalcularla.

### Fase 1 — Núcleo: tiempo, líneas Laravel y correlación

#### Added
- **`LogEvent.ts`**: epoch ms UTC ya resuelto. El consumidor ordena y agrupa sin volver a parsear `timestamp`.
- **`LogEvent.correlation`**: `traceId`, `sessionId`, `transactionId`, `placetopayId`, `reference`, `internalReference`, `provider`, `operation`, `tenant`, `tenantId`, `siteId`, `login`, extraídos según el contrato de los emisores (no por heurística).
- **`LaravelLineParser`** (`src/common/strategies/`): parser de líneas Monolog compartido por las tres apps. Expone `channel` (pista de proveedor) y `extra` por separado.
- **`toEpochMs`**, **`buildCorrelation`**, **`buildEventBase`** exportados para mappers personalizados.

#### Fixed
- **Marcas de tiempo no deterministas**: `2025-12-28 22:14:01` (sin offset) se interpretaba en la zona horaria de la máquina. Ahora se fija a `DEFAULT_TZ_OFFSET` (`-05:00`, lo que emite producción).
- **Offsets recortados a horas**: `2025-12-28T22:14:01.362-05` daba `NaN` en `Date.parse`; ahora se normaliza.
- **Niveles Monolog numéricos**: sin `level_name`, el nivel llegaba como la cadena `"200"`. Se mapean 100–600 a `LogLevel`, y se colapsan los alias PSR-3 (`NOTICE`, `ALERT`, `EMERGENCY`).
- **`context` y `extra` fusionados**: el parser de líneas Laravel mezclaba ambos bloques de Monolog con `Object.assign`, de modo que campos como `extra.tenantId` aparecían como contexto de aplicación.
- **Ids inestables**: `buildEventId` usaba la posición de la línea en el fichero, así que el mismo log recibía ids distintos según el recorte del export. Ahora deriva de su contenido.
- **Orden con fechas inválidas**: el comparador devolvía `NaN`; ahora esos eventos van al final.

### Changed (rupturas)
- `NormalizedLogData.level` pasa de `string` a `LogLevel`.
- `buildEventId(ctx, index)` → `buildEventId(ctx, seed)`.
- `CheckoutLocalParser` eliminado (no era parte de la API pública): usar `LaravelLineParser`.
- `CheckoutMapper` trataba `level === "500"` como error de validación; ahora es `level === "CRITICAL"`, que es el mismo nivel de Monolog tras la normalización. Marcado con `ponytail:` para revisar en la Fase 5.

## [1.3.0] - 2026-05-17

### Changed
- **Mapper decomposition**: `CheckoutMapper.map()` (204→55 lines) and `RestMapper.map()` (133→48 lines) split into focused private methods. Gateway path if/else chain replaced with lookup table.
- **Strategy deduplication**: Shared parser utilities (`buildNormalizedLogData`, `resolveTimestamp`, `normalizeLevel`, etc.) extracted to `src/utils/parsers.ts`, used by all 5 JSON strategies.
- **Constants centralization**: `src/common/constants.ts` with shared `RAW_STREAM_MAX_LENGTH`, domain markers, and gateway path labels.
- **Metadata extractor refactor**: `CheckoutMetadataExtractor.extract()` decomposed into 6 private methods with try/catch safety.
- **`sourceType` required**: No longer optional; unused `"UNKNOWN"` literal removed from the union.
- **Mappers unified**: `??` in all mappers, `GenericMapper` receives `appType` via constructor, `isMatch` uses exact match everywhere.

### Added
- **Expanded public API**: `ParseMetadata`, `CheckoutParseMetadata`, `RestParseMetadata`, `MicrositesParseMetadata`, `DomainMetadata`, `mergeCheckoutActions`, `mergeRestActions`, `LogMapper`, and mapper utilities now exported.
- **Sort stability**: Third tie-break by event ID guarantees deterministic ordering.

### Fixed
- **`normalizePath`**: HTML entity `&quot;` now correctly matched (was missing `;`).
- **`extractTimestamp`**: Length guard prevents malformed output on short lines.
- **Metadata pollution**: `RestMetadataExtractor` and `MicrositesMetadataExtractor` now filter by `event.appType`.
- **Sort precision**: Req/Res detection uses `"HTTP Req"`/`"HTTP Res"` instead of loose substring match.

### Removed
- **Dead types**: `SessionFunnelSteps` and `SessionFunnelRow`.

## [1.2.3] - 2026-04-21

### Changed
- **Frontend Request Mapping**: Improved descriptions for `/user` and `/information` endpoints in Checkout logs. These are now correctly identified as "Frontend: User data validation" and "Frontend: Requesting payment method information" respectively, instead of the generic "Payment methods view".
- **Source Identification**: Ensured these frontend requests are correctly attributed to the `FRONTEND` source with `USER_ACTION` category.

### Added
- **Unit Tests**: Added test cases to `CheckoutMapper.test.ts` to verify the refined mapping for specific frontend-to-backend endpoint traces.

## [1.2.2] - 2026-04-21

### Changed
- **Interest Calculation Titles**: Improved log titles for interest-related operations. "Request trace" logs for interest are now identified as "Interest Calculation Request" with `FRONTEND` source.
- **Gateway Interest Mapping**: Added specific handling for `/gateway/interests` endpoint in Gateway logs, providing clearer titles and including status/reason suffixes (e.g., `[REJECTED] (NR)`).

### Added
- **Unit Tests**: Added comprehensive tests in `CheckoutMapper.test.ts` to validate interest calculation mapping and source identification.

## [1.2.1] - 2026-04-21

### Fixed
- **Log Event Sorting**: Improved timestamp tie-breaking in `P2PParserEngine` to guarantee `HTTP Req` is sorted before `HTTP Res` on identical timestamps.

### Changed
- **Wallet OTP Detection**: Added dynamic mapping for Wallet P2P OTP (`requestOtp`, `checkOtp`) in `CheckoutMapper`.
- **Frontend Tracing**: Generic `Request trace` logs are now correctly identified as `FRONTEND` source.
## [1.2.0] - 2026-03-30

### Added
- **Grafana JSON Line Parser**: Added `CheckoutGrafanaJsonParser` to precisely parse logs exported from Grafana CloudWatch in JSON/text line format. Integrates natively with `P2PParserEngine` via auto-detection.

## [1.1.1] - 2026-03-30

### Added
- **JSON Insights Parser**: Upgraded `CheckoutInsightsParser` to natively parse JSON arrays/objects from AWS CloudWatch Insights, preserving fallback to the existing regex matcher.
- **AutoPay Support**: Added explicit detection for `AUTOPAY` session types based on the request payload.

### Changed
- **Simplified Session Types**: Streamlined `CheckoutMetadataExtractor` logic by deprecating unreliable `COLLECT` identification and focusing purely on `PAYMENT`, `SUBSCRIPTION`, and `AUTOPAY` types depending on explicit request payload markers.

## [1.1.0] - 2026-03-24

### Added
- **Domain-Aware Metadata Strategy**: Refactored `P2PParserEngine` to use a flexible `MetadataExtractor` strategy pattern, decoupling core logic from domain-specific metadata requirements.
- **Advanced Checkout Session Metadata**: Metadata for Checkout now includes a detailed `sessions` array (replacing `sessionIds`) with funnel tracking, session types (`PAYMENT`, `COLLECT`, `SUBSCRIPTION`), feature flags (OTP, 3DS, Interests), final states, and transaction success status.
- **Structured Reference Extraction**: Checkout sessions now include a `reference` field extracted directly from the request payload bodies.
- **Grafana CloudWatch Parser**: Replaced `CheckoutNewRelicParser` with `CheckoutGrafanaCsvParser`. This new parser exclusively handles Grafana-specific CSV exports with escaped JSON payloads.
- **Parser Metadata Discovery**: Added `getSupportedFormats()` method to `P2PParserEngine`, allowing integrators to discover available parsers, their descriptions, and detection rules (regex).

### Changed
- `ParseMetadata` is now a discriminated union (`CheckoutParseMetadata`, `RestParseMetadata`, `MicrositesParseMetadata`) for improved type safety across different domains.

## [1.0.5] - 2026-03-23

### Changed
- Improved `CheckoutMapper` message correctly displaying whether the 3DS process started in a `Lightbox` or `Redirection` flow via context payload.
- `Validation Layer` fallbacks are now resolved to `null` to avoid breaking frontend URL generation endpoints.

## [1.0.4] - 2026-03-23

### Added
- Extensible action maps: integrators can now override or add custom `CheckoutActionMap` and `RestActionMap` entries via `P2PParserEngineConfig`.
- New public exports: `P2PParserEngineConfig`, `CheckoutActionDetail`, and `RestActionDetail`.

### Fixed
- Added `types` condition to the `exports` field in `package.json` so TypeScript correctly resolves type declarations when consuming the package.

## [1.0.3] - 2026-03-23

### Changed
- Unified CI tests and NPM CD deployment into a single, high-performance GitHub Actions workflow (`ci.yml`), removing duplicate builds and artifacts.

## [1.0.2] - 2026-03-23

### Changed
- Renamed the NPM package scope to `@andrextor_ia11012/p2p-log-parser` to fix publishing permissions.

## [1.0.1] - 2026-03-23

### Changed
- Automated NPM library deployment with GitHub Actions (`release-main.yml`).
- Upgraded CI configuration to resolve GitHub Actions Node 24 deprecation warnings.

## [1.0.0] - 2026-03-23

### Added
- Initial release of the `@p2p/log-parser` library.
- Core parsing and masking logic for sensitive transaction data from Placetopay JSON payloads.
- Automated redaction of credit card numbers (PAN), CVV, and expiration dates.
- Standardized TypeScript interfaces for strict type checking.
- CJS and ESM module exports using Vite (Library Mode).
