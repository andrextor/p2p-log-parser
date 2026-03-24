import type {
  DomainMetadata,
  MetadataExtractor,
} from "@/common/metadata/MetadataExtractor";
import { AppTypes, type LogEvent, type RestDetails } from "@/types";

export interface RestParseMetadata extends DomainMetadata {
  totalOperations: number;
  operations: string[];
  providers: string[];
}

export class RestMetadataExtractor
  implements MetadataExtractor<RestParseMetadata>
{
  readonly appType = AppTypes.REST;

  extract(events: LogEvent[]): RestParseMetadata | undefined {
    const operations = new Set<string>();
    const providers = new Set<string>();

    for (const event of events) {
      const details = event.details as RestDetails;
      if (details?.operation) operations.add(details.operation);
      if (details?.provider) providers.add(details.provider);
    }

    if (operations.size === 0 && providers.size === 0) return undefined;

    return {
      totalEvents: events.length,
      totalOperations: operations.size,
      operations: Array.from(operations),
      providers: Array.from(providers),
    };
  }
}
