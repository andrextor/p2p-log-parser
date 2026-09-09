import type {
  DomainMetadata,
  MetadataExtractor,
} from "@/common/metadata/MetadataExtractor";
import { AppTypes, type LogEvent, type RestDetails } from "@/types";

export interface RestParseMetadata extends DomainMetadata {
  totalRequests: number;
  requestsByProvider: Record<string, number>;
  totalOperations: number;
  operations: string[];
  providers: string[];
  errors: RestErrorSummary[];
}

export interface RestErrorSummary {
  provider: string;
  operation: string;
  code?: string;
  message: string;
  ts: number;
}

export class RestMetadataExtractor
  implements MetadataExtractor<RestParseMetadata>
{
  readonly appType = AppTypes.REST;

  extract(events: LogEvent[]): RestParseMetadata | undefined {
    const operations = new Set<string>();
    const providers = new Set<string>();
    const requestsByProvider: Record<string, number> = {};
    const errors: RestErrorSummary[] = [];
    let totalRequests = 0;

    for (const event of events) {
      if (event.appType !== AppTypes.REST) continue;
      const details = event.details as RestDetails;

      if (details?.operation) operations.add(details.operation);

      const provider = details?.provider ?? "";
      if (provider) providers.add(provider);

      if (
        event.category === "HTTP_REQ_OUT" ||
        event.category === "HTTP_REQ_IN"
      ) {
        totalRequests++;
        if (provider) {
          requestsByProvider[provider] =
            (requestsByProvider[provider] ?? 0) + 1;
        }
      }

      if (event.category === "ERROR") {
        errors.push({
          provider: provider || "unknown",
          operation: details?.operation ?? "unknown",
          code: details?.statusCode ? String(details.statusCode) : undefined,
          message: event.message,
          ts: event.ts,
        });
      }
    }

    if (operations.size === 0 && providers.size === 0) return undefined;

    return {
      totalEvents: events.length,
      totalRequests,
      requestsByProvider,
      totalOperations: operations.size,
      operations: Array.from(operations),
      providers: Array.from(providers),
      errors,
    };
  }
}
