# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.4] - 2026-03-23

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
