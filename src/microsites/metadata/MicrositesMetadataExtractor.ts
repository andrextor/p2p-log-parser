import type {
  DomainMetadata,
  MetadataExtractor,
} from "@/common/metadata/MetadataExtractor";
import { AppTypes, type LogEvent, type MicrositesDetails } from "@/types";

export interface MicrositesParseMetadata extends DomainMetadata {
  totalSites: number;
  siteIds: string[];
}

export class MicrositesMetadataExtractor
  implements MetadataExtractor<MicrositesParseMetadata>
{
  readonly appType = AppTypes.MICROSITES;

  extract(events: LogEvent[]): MicrositesParseMetadata | undefined {
    const siteIds = new Set<string>();

    for (const event of events) {
      const details = event.details as MicrositesDetails;
      if (details?.siteId) {
        siteIds.add(String(details.siteId));
      }
    }

    if (siteIds.size === 0) return undefined;

    return {
      totalEvents: events.length,
      totalSites: siteIds.size,
      siteIds: Array.from(siteIds),
    };
  }
}
