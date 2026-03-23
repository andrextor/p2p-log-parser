import { describe, it, expect } from 'vitest';
import { CheckoutMapper } from '@/checkout/mappers/CheckoutMapper';
import { NormalizedLogData } from '@/types';

describe('CheckoutMapper', () => {
  const mapper = new CheckoutMapper();

  it('should extract correct displayMessage for Gateway generation', () => {
    const logData: NormalizedLogData = {
      timestamp: '2025-12-28T22:17:03.886969-05:00',
      level: '200',
      message: '[GW_LIB] HTTP Res',
      context: {
        response: {
          url: 'https://api.placetopay.ec/gateway/otp/generate',
          body: {
            status: { status: 'OK' }
          }
        }
      }
    };

    const result = mapper.map(logData, '', 1);

    expect(result.message).toBe('Gateway: OTP Generation [OK]');
    expect(result.category).toBe('HTTP_RES');
  });

  it('should extract exact validation reason for Gateway OTP validation error', () => {
    const logData: NormalizedLogData = {
      timestamp: '2025-12-28T22:20:32.067427-05:00',
      level: '200',
      message: '[GW_LIB] HTTP Res',
      context: {
        response: {
          url: 'https://api.placetopay.ec/gateway/otp/validate',
          body: {
            status: { status: 'FAILED', reason: 'OT0099' }
          }
        }
      }
    };

    const result = mapper.map(logData, '', 2);

    expect(result.message).toBe('Gateway: OTP Validation [FAILED] (OT0099)');
    expect(result.category).toBe('HTTP_RES');
  });

  it('should infer Db Update category accurately', () => {
    const logData: NormalizedLogData = {
      timestamp: '2025-12-28T22:20:32.073501-05:00',
      level: '200',
      message: 'Update session state trace: Updating',
      context: {}
    };

    const result = mapper.map(logData, '', 3);

    expect(result.message).toBe('State Update (Session)');
    expect(result.category).toBe('DB_OP');
  });
});
