import { ApiProperty } from '@nestjs/swagger';
import { InvestmentDistributionTypeEnum } from '@prisma/client';

export class NavHistoryPointDTO {
  @ApiProperty({ type: Date })
  date: Date;

  @ApiProperty({ type: Number, description: 'NAV per unit in kobo' })
  navPerUnit: number;

  @ApiProperty({
    type: Number,
    description: 'Return basis points vs. first point in window',
  })
  returnBps: number;
}

export class NavHistoryResponseDTO {
  @ApiProperty({ type: () => [NavHistoryPointDTO] })
  points: NavHistoryPointDTO[];

  @ApiProperty({ type: Number, description: 'Total return bps over window' })
  totalReturnBps: number;

  @ApiProperty({ type: Number, description: 'Annualised return (CAGR) in bps' })
  cagrBps: number;
}

export class NavSnapshotDTO {
  @ApiProperty({ type: Number, description: 'Current NAV per unit in kobo' })
  navPerUnit: number;

  @ApiProperty({ type: Date })
  asOf: Date;

  @ApiProperty({
    type: Number,
    description: '24h change in bps (positive or negative)',
  })
  change24hBps: number;

  @ApiProperty({
    type: Number,
    description: 'YTD return in bps (since Jan 1 of current year)',
  })
  ytdReturnBps: number;
}

export class SectorSliceDTO {
  @ApiProperty({ type: String, example: 'Financials' })
  sector: string;

  @ApiProperty({ type: Number, description: '0–100' })
  percent: number;

  @ApiProperty({
    type: Number,
    description: 'AUM share in kobo (illustrative; seeded)',
  })
  amount: number;
}

export class SectorAllocationResponseDTO {
  @ApiProperty({ type: () => [SectorSliceDTO] })
  slices: SectorSliceDTO[];
}

export class DistributionDTO {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ type: Date })
  paidAt: Date;

  @ApiProperty({ type: Number, description: 'Payout per unit in kobo' })
  amountPerUnit: number;

  @ApiProperty({
    type: Number,
    description: 'Total paid across the fund (illustrative; seeded)',
  })
  totalPaid: number;

  @ApiProperty({ enum: InvestmentDistributionTypeEnum })
  type: InvestmentDistributionTypeEnum;
}

export class DistributionsResponseDTO {
  @ApiProperty({ type: () => [DistributionDTO] })
  distributions: DistributionDTO[];
}
