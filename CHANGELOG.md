# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
 
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
