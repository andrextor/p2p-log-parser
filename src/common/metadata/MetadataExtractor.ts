import type { AppType, LogEvent } from "@/types";

export interface DomainMetadata {
  totalEvents: number;
}

export interface MetadataExtractor<T extends DomainMetadata = DomainMetadata> {
  readonly appType: AppType;
  extract(events: LogEvent[]): T | undefined;
}
