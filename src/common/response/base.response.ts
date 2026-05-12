import { ApiProperty } from '@nestjs/swagger';
import { ErrorsType, Meta, Pagination, PaginationDetailsDTO } from './base.dto';

class BaseResponse<T> {
  @ApiProperty({
    type: Object,
    description:
      'Response payload. Overridden per endpoint via the ApiOkResponseData helper.',
  })
  data: T;

  @ApiProperty({ type: () => Meta, required: false })
  meta?: Meta;

  @ApiProperty({ type: () => Pagination, required: false })
  pagination?: Pagination;

  constructor(data: T, paginationData?: PaginationDetailsDTO) {
    this.data = data;
    if (paginationData) {
      const { meta, pagination } = this.getPaginationDetails(paginationData);
      this.meta = meta;
      this.pagination = pagination;
    }
  }

  constructResponse() {
    const data = this.data;
    const meta = this.meta;
    const pagination = this.pagination;

    if (typeof data === 'string') {
      return {
        message: data,
        meta,
        pagination,
      };
    }
    return { data, meta, pagination };
  }

  private constructPagination(
    presentPage: number,
    limit: number,
    total: number,
    hasPreviousPage: boolean = false,
    hasNextPage: boolean = false,
    totalPage: number,
  ): Pagination {
    return {
      presentPage,
      total,
      limit,
      previousPage: hasPreviousPage ? presentPage - 1 : null,
      nextPage: hasNextPage ? presentPage + 1 : null,
      totalPage,
    };
  }

  private constructMeta(
    presentLink: string,
    previousLink: string | null = null,
    nextLink: string | null = null,
  ): Meta {
    return {
      nextLink,
      previousLink,
      presentLink,
    };
  }

  getPaginationDetails(data: PaginationDetailsDTO) {
    const { totalItems, limit, page, req } = data || {};
    const { protocol, originalUrl } = req;
    const host = req.headers['host'] || undefined;
    const totalPages = Math.floor(totalItems / limit);
    const hasNextPage = totalPages > page;
    const hasPreviousPage = page > 1;

    const presentLink = `${protocol}://${host}${originalUrl}`;

    let nextLink: string | null = null;
    let previousLink: string | null = null;

    if (hasNextPage) {
      const urlObj = new URL(presentLink);
      urlObj.searchParams.set('page', (page + 1)?.toString());
      nextLink = urlObj.toString();
    }

    if (hasPreviousPage) {
      const urlObj = new URL(presentLink);
      urlObj.searchParams.set('page', (page - 1)?.toString());
      previousLink = urlObj.toString();
    }

    const meta = this.constructMeta(presentLink, previousLink, nextLink);
    const pagination = this.constructPagination(
      page,
      limit,
      totalItems,
      hasPreviousPage,
      hasNextPage,
      totalPages,
    );
    return { meta, pagination };
  }

  static constructErrorResponse(message: string, errors?: ErrorsType) {
    return { message, errors };
  }
}

export default BaseResponse;
