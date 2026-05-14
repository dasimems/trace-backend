import { ApiProperty } from '@nestjs/swagger';

export type CachedInsightStatus = 'fresh' | 'pending';

// Wrapper for GET endpoints. `status: "pending"` means no cache yet — the
// frontend should open the SSE stream and wait for the completed event.
// `status: "fresh"` means `value` is populated; `lastUpdated` tells the
// frontend how stale the data is.
export class CachedInsightDTO<T> {
  @ApiProperty({ enum: ['fresh', 'pending'] })
  status: CachedInsightStatus;

  @ApiProperty({
    type: Date,
    nullable: true,
    description: 'ISO timestamp of the last successful refresh; null if no cache yet.',
  })
  lastUpdated: Date | null;

  @ApiProperty({
    nullable: true,
    description: 'The cached analysis payload, or null when pending.',
  })
  value: T | null;
}

export interface CachedEntry<T> {
  value: T;
  lastUpdated: string; // ISO string — Keyv serializes through JSON
}
