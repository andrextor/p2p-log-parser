import fs from 'fs';
import { P2PParserEngine } from './src/engine';

const csv = fs.readFileSync('/tmp/sample.csv', 'utf-8');
const engine = new P2PParserEngine();
const result = engine.parse(csv, 'ALL');

console.log(`Parsed ${result.events.length} events.`);
if (result.errors.length) {
  console.log(`Errors:`, result.errors);
}

if (result.metadata) {
  console.log(`\nMetadata:\n`, JSON.stringify(result.metadata, null, 2));
}

console.log(`\nGrouped Events:`);
if (result.groupedBySession) {
  for (const [sessionId, events] of Object.entries(result.groupedBySession)) {
    console.log(`\n--- Session: ${sessionId} ---`);
    events.forEach(e => {
      const dt = (e.details as any);
      console.log(`[${e.timestamp}] ${e.category} | ${e.message} | Src: ${dt.source} | Sub: ${dt.subType}`);
    });
  }
}
