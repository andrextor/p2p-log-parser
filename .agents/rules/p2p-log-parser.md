---
trigger: always_on
---

# Project: @p2p/log-parser (Placetopay)
- Goal: Parse and mask sensitive transaction data from Placetopay JSON payloads.

# Path Aliases
- ALWAYS use the `@/` alias for imports from the `src` directory.
- Example: `import { x } from '@/types';`

# Directory Structure
- `src/core/`: Principal parsing and masking logic.
- `src/types/`: TypeScript interfaces and type definitions.
- `src/utils/`: Helper functions.
- `src/constants/`: Sensitive fields and fixed values.

# Implementation Details
- Use Design Patterns (Strategy or Factory) if parsing complexity increases.
- Masking logic must redact: credit card numbers (PAN), CVV, and expiration dates by default.
- Bundler: Vite 5 (Library Mode).