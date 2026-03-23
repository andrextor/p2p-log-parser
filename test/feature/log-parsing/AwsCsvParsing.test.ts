import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { P2PParserEngine } from '@/engine';
import { AppTypes } from '@/types';

describe('AWS CSV CloudWatch Parsing (End to End)', () => {
  it('should parse the full sample accurately simulating client behavior', () => {
    // The previously used sample data for testing.
    const csvContent = fs.readFileSync(path.resolve(__dirname, '../../fixtures/sample.csv'), 'utf-8');
    
    const engine = new P2PParserEngine();
    const result = engine.parse(csvContent, AppTypes.CHECKOUT);

    expect(result.events.length).toBe(8);
    expect(result.errors).toHaveLength(0);

    expect(result.metadata).toBeDefined();
    expect(result.metadata?.totalSessions).toBe(3);
    
    expect(result.groupedBySession).toBeDefined();
    if (!result.groupedBySession) return;
    
    // 64495535 block should have the gateway errors and HTTP Res handled properly
    const sessionBlock = result.groupedBySession['64495535'];
    expect(sessionBlock).toBeDefined();
    expect(sessionBlock.length).toBe(3);

    // Verifying deeper mapper functionality inside the e2e test
    expect(sessionBlock[0].message).toContain('Gateway: OTP Generation');
    expect(sessionBlock[2].message).toBe('OTP Validation Error [DINERS]');
  });
});
