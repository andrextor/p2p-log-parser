import { LogEvent, NormalizedLogData } from "@/types";

export interface LogMapper {
  /**
   * Evaluates if the normalized data belongs to its domain
   */
  canHandle(data: NormalizedLogData): boolean;

  /**
   * Action: Converts the normalized data into a structured event.
   */
  map(data: NormalizedLogData, rawLine: string, index: number): LogEvent;

  /**
   * Determines if an event matches a target ID for tracing.
   */
  isMatch(event: LogEvent, targetId: string): boolean;
}
