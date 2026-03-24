# @p2p/log-parser

A strict, high-performance, Domain-Driven Node.js backend library for parsing, masking, and categorizing Placetopay application logs.

## Features

- **Strictly Typed:** Written in strict TypeScript (`100%`) offering bullet-proof definitions.
- **UI Decoupled:** A purely structural parsing utility independent of frontend frameworks or styling limitations. Designed natively for Node backend integrations.
- **Auto Data Masking:** Redacts sensitive payment data such as PAN, CVV, and credit card expiration dates automatically from logs.
- **Intelligent Parsers:** Seamlessly identifies and parses structural log dumps from: 
  - AWS CloudWatch CSVs (Checkout Insights).
  - New Relic JSON arrays.
  - Laravel generic local `laravel.log` lines.
- **Hierarchical Log Grouping:** Automatically merges distributed multi-session request traces into structured Session ID -> Execution Time dimensions.
- **Domain Mappers:** Built with modular sub-mappers specific to Placetopay domains (Core API REST, Checkout, and Microsites).

## Installation

You can install this internal dependency into your project using NPM:

```bash
npm i @andrextor_ia11012/p2p-log-parser
```

## Basic Usage

The entrypoint to start parsing logs is the orchestrator `P2PParserEngine`.

```typescript
import { P2PParserEngine, AppTypes } from '@p2p/log-parser';

// 1. Initialize the root Engine
const engine = new P2PParserEngine();

// 2. Fetch or receive your multi-line raw payload (e.g. from AWS or a file output)
const rawCsvOrJsonContent = \`"Time","__log__grafana_internal__","@message"
2025-12-28 22:14:00,x,"{""message"":""placetopay_event"",""type"":""checkout.session.created"",""session_id"":64495535}"\`;

// 3. Parse specific application logs or use 'ALL' to infer strategies dynamically
const result = engine.parse(rawCsvOrJsonContent, AppTypes.CHECKOUT);

// Array of all linearly flat parsed log events
console.log(result.events);

// Multi-dimensionally grouped logs: Record<SessionId, Record<ExecutionTime, LogEvent[]>>
console.log(result.groupedBySession);

// Additional metadata for multi-session datasets
console.log(result.metadata);
```

### Custom Action Maps

You can extend or override the built-in action maps by passing a `P2PParserEngineConfig`:

```typescript
import { P2PParserEngine } from '@p2p/log-parser';
import type { CheckoutActionDetail, RestActionDetail } from '@p2p/log-parser';

const engine = new P2PParserEngine({
  customCheckoutActions: {
    // Override an existing action
    entry: { message: 'My Custom Entry', category: 'BROWSER_LOAD', source: 'FRONTEND' },
    // Add a new action
    myFlow: { message: 'Integrator Flow', category: 'HTTP_REQ_IN', source: 'BACKEND' },
  },
  customRestActions: {
    refund: { message: 'Refund Operation', category: 'PAYMENT', source: 'BACKEND' },
  },
});
```

Custom actions are **merged** with the defaults — existing keys are overridden, new keys are added.

### Supported Apps
The library splits strategies cleanly over 3 domain blocks via `AppTypes`:
- \`AppTypes.CHECKOUT\`
- \`AppTypes.REST\` 
- \`AppTypes.MICROSITES\` (Generic Strategy)

## Built with Modern Standards
- **Compiler/Bundler:** Vite 5 (Library Mode).
- **Quality & Linting:** Biomejs strictly configured with 2-level spacing and deep heuristics.
- **Testing:** `vitest` unit and integration tests under the explicit `test/` scope.

## Developer Quick Start

Clone this repository and run standard scripts:

```bash
# Install dependencies
npm install

# Run the entire test suite natively
npm run test

# Run strict code format checking
npm run lint

# Build production distributable artifacts using Vite Library Mode
npm run build
```

## License
Confidential - Property of Placetopay (Evertec).
