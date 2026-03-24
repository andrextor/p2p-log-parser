import type { NormalizedLogData } from "@/types";

export interface StrategyMetadata {
  name: string;
  description: string;
  detectionRule: string;
}

export interface LogExtractionStrategy {
  /**
   * Attempts to parse a line of text.
   * Returns null if the format does not match this strategy.
   */
  parse(line: string): NormalizedLogData | null;

  /**
   * Returns metadata about the strategy for integrator discovery.
   */
  getMetadata(): StrategyMetadata;
}
