import type { LogPayload, ParserOptions } from '@/types';

/**
 * Clase principal para parsear y limpiar logs de Placetopay.
 */
export class P2PLogParser {
  private options: ParserOptions;

  constructor(options: ParserOptions = {}) {
    this.options = {
      maskFields: options.maskFields || [],
      ...options,
    };
  }

  /**
   * Parsea y limpia un payload de log.
   * @param data - El payload del log, puede ser un string JSON o un objeto.
   * @returns Un objeto `LogPayload` con los datos estructurados y limpios.
   */
  public parse(data: unknown): LogPayload {
    const timestamp = new Date();
    let originalData: unknown = data;
    let parsedData: Record<string, any> = {};
    const errors: string[] = [];

    try {
      if (typeof data === 'string') {
        parsedData = JSON.parse(data);
        originalData = { ...parsedData };
      } else if (typeof data === 'object' && data !== null) {
        parsedData = JSON.parse(JSON.stringify(data));
        originalData = data;
      } else {
        throw new Error('Invalid data format. Expected a JSON string or an object.');
      }

      if (this.options.maskFields && this.options.maskFields.length > 0) {
        this.mask(parsedData, this.options.maskFields);
      }

    } catch (error) {
      if (error instanceof Error) {
        errors.push(error.message);
      } else {
        errors.push('An unknown error occurred during parsing.');
      }
    }

    return {
      originalData,
      parsedData,
      errors,
      timestamp,
    };
  }

  /** 
   * Función recursiva para enmascarar campos sensibles.
   * @param obj - El objeto a enmascarar.
   * @param fieldsToMask - Array de keys a enmascarar.
   */
  private mask(obj: Record<string, any>, fieldsToMask: string[]): void {
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        if (fieldsToMask.includes(key)) {
          obj[key] = '***MASKED***';
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
          this.mask(obj[key], fieldsToMask);
        }
      }
    }
  }
}
