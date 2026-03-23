/**
 * Opciones de configuración para el parser.
 */
export interface ParserOptions {
  /**
   * Define los campos que deben ser enmascarados en el log.
   * Por ejemplo: ['creditCard', 'cvv']
   */
  maskFields?: string[];
}

/**
 * Representa la estructura de un log después de ser parseado.
 */
export interface LogPayload {
  originalData: unknown;
  parsedData: Record<string, any>;
  errors: string[];
  timestamp: Date;
}
