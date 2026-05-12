import { ApiProperty } from '@nestjs/swagger';
import { CustomRequest } from '@common/authentication/authentication.dto';

export interface ErrorsType {
  [name: string]: string;
}

export interface PaginationDetailsDTO {
  page: number;
  limit: number;
  req: CustomRequest;
  totalItems: number;
}

export interface AttachmentDetailsDBDto {
  url: string;
}

export class Meta {
  @ApiProperty({ type: String, nullable: true })
  nextLink: string | null;

  @ApiProperty({ type: String, nullable: true })
  previousLink: string | null;

  @ApiProperty({ type: String })
  presentLink: string;
}

export class Pagination {
  @ApiProperty({ type: Number })
  presentPage: number;

  @ApiProperty({ type: Number })
  total: number;

  @ApiProperty({ type: Number })
  limit: number;

  @ApiProperty({ type: Number, nullable: true })
  previousPage: number | null;

  @ApiProperty({ type: Number, nullable: true })
  nextPage: number | null;

  @ApiProperty({ type: Number })
  totalPage: number;
}
