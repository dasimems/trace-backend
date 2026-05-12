import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { QUERY_LIMIT } from '../../shared/constants';

@Injectable()
export class PrismaService extends PrismaClient {
  constructor() {
    super({
      datasources: {
        db: {
          url: process.env.DATABASE_URL!,
        },
      },
    });
  }

  private generateSkipNumber(page: number, limit: number) {
    return (page - 1) * limit;
  }

  getPaginationDetails<T extends { page?: string; limit?: string }>(
    paginationData: T,
  ) {
    const {
      page: queryPage = '1',
      limit: queryLimit = QUERY_LIMIT.toString(),
    } = paginationData || {};
    let page = parseInt(queryPage);
    let limit = parseInt(queryLimit);
    if (isNaN(page)) {
      page = 1;
    }

    if (isNaN(limit)) {
      limit = QUERY_LIMIT;
    }

    const skip = this.generateSkipNumber(page, limit);
    return { page, limit, skip };
  }

  sanitizeRawText(text: string) {
    return text.replace(/[\0\n\r\\'%_]/g, (ch) => {
      switch (ch) {
        case '\0':
          return '\\0';
        case '\n':
          return '\\n';
        case '\r':
          return '\\r';
        default:
          return '\\' + ch;
      }
    });
  }
}
