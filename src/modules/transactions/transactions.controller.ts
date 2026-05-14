import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CustomRequest } from '@common/authentication/authentication.dto';
import { AuthGuard } from '@common/authentication/authentication.guard';
import { ApiOkResponseData } from '@common/response/api-response.decorator';
import { TransactionMetricsResponseDTO } from '@common/response/transaction/transaction-metrics.dto';
import { TransactionResponseDTO } from '@common/response/transaction/transaction.dto';
import { routes, subRoutes } from '@shared/variables';
import { GetTransactionsQueryDTO } from './transactions.dto';
import { TransactionsService } from './transactions.service';

@ApiTags('Transactions')
@ApiBearerAuth('access-token')
@UseGuards(AuthGuard)
@Controller(routes.transactions)
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Get('/')
  @HttpCode(200)
  @ApiOperation({
    summary: 'List the current user’s transactions with filters & pagination',
  })
  @ApiOkResponseData(TransactionResponseDTO, {
    isArray: true,
    description: 'Paginated transactions.',
  })
  list(@Query() query: GetTransactionsQueryDTO, @Req() req: CustomRequest) {
    return this.transactionsService.listTransactions(query, req);
  }

  @Get(subRoutes.metrics)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Get inflow/outflow/pending/failed metrics for the current month',
  })
  @ApiOkResponseData(TransactionMetricsResponseDTO, {
    description: 'Aggregate metrics across the user’s transactions.',
  })
  metrics(@Req() req: CustomRequest) {
    return this.transactionsService.getMetrics(req);
  }

  @Get('/:id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get a single transaction by id' })
  @ApiOkResponseData(TransactionResponseDTO, {
    description: 'Transaction detail.',
  })
  detail(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: CustomRequest,
  ) {
    return this.transactionsService.getTransaction(id, req);
  }
}
