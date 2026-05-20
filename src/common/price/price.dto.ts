import { ApiProperty } from '@nestjs/swagger';

export class PricePart {
  @ApiProperty({ type: Number })
  whole: number;

  @ApiProperty({ type: Number })
  subUnit: number;

  @ApiProperty({ type: Number })
  smallestUnit: number;
}

export class PriceCurrency {
  @ApiProperty({ type: String })
  symbol: string;

  @ApiProperty({ type: String })
  name: string;

  @ApiProperty({ type: String })
  code: string;

  @ApiProperty({ type: String })
  locale: string;
}

export class PriceFormatted {
  @ApiProperty({ type: String })
  withCurrency: string;

  @ApiProperty({ type: String })
  withoutCurrency: string;
}

export class Price {
  @ApiProperty({ type: Number })
  amount: number;

  @ApiProperty({ type: () => PricePart })
  parts: PricePart;

  @ApiProperty({ type: () => PriceCurrency })
  currency: PriceCurrency;

  @ApiProperty({ type: () => PriceFormatted })
  formatted: PriceFormatted;
}
