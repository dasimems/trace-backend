import { ApiProperty } from '@nestjs/swagger';
import { Price } from '@common/price/price.dto';

export class SpendHeatmapCellDTO {
  @ApiProperty({
    type: Number,
    description: '0 = Monday, 6 = Sunday',
    example: 0,
  })
  dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6;

  @ApiProperty({ type: Number, description: '0–23 (UTC hour)', example: 19 })
  hour: number;

  @ApiProperty({ type: () => Price, description: 'Total spend in cell' })
  amount: Price;

  @ApiProperty({ type: Number, description: 'Number of debits' })
  txCount: number;
}

export class SpendHeatmapPeakDTO {
  @ApiProperty({ type: Number })
  dayOfWeek: number;

  @ApiProperty({ type: Number })
  hour: number;

  @ApiProperty({ type: () => Price, description: 'Peak-cell spend' })
  amount: Price;
}

export class SpendHeatmapResponseDTO {
  @ApiProperty({
    type: () => [SpendHeatmapCellDTO],
    description:
      'Sparse grid — only cells with at least one debit are included.',
  })
  cells: SpendHeatmapCellDTO[];

  @ApiProperty({ type: Date })
  rangeStart: Date;

  @ApiProperty({ type: Date })
  rangeEnd: Date;

  @ApiProperty({ type: () => Price, description: 'Total spend over range' })
  totalSpend: Price;

  @ApiProperty({
    type: () => SpendHeatmapPeakDTO,
    nullable: true,
    required: false,
  })
  peakCell: SpendHeatmapPeakDTO | null;
}
