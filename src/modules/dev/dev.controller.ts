import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CustomRequest } from '@common/authentication/authentication.dto';
import { AuthGuard } from '@common/authentication/authentication.guard';
import { LoansAutoDeductionService } from '@modules/loans/loans-auto-deduction.service';
import { routes, subRoutes } from '@shared/variables';
import { SeedTransactionsBodyDTO } from './dev.dto';
import { NonProductionGuard } from './dev.guard';
import { DevService } from './dev.service';

@ApiTags('Dev')
@ApiBearerAuth('access-token')
// Order matters: refuse in production BEFORE checking auth so prod attackers
// see 403 not 401 (less info).
@UseGuards(NonProductionGuard, AuthGuard)
@Controller(routes.dev)
export class DevController {
  constructor(
    private readonly devService: DevService,
    private readonly loansAutoDeductionService: LoansAutoDeductionService,
  ) {}

  @Post('/loans/process-repayments')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Run the loan auto-deduction sweep on demand',
    description:
      'Dev-only. Triggers the same routine the scheduler runs every cycle: finds DUE installments across all active loans and sweeps them against each user’s bank balance, recording partial debits when balance is short.',
  })
  processLoanRepayments() {
    return this.loansAutoDeductionService.run();
  }

  @Post(subRoutes.seedTransactions)
  @HttpCode(201)
  @ApiOperation({
    summary: 'Seed ~90 days of synthetic transactions for the current user',
    description:
      'Dev-only. Generates monthly salary inflows and daily outflows across realistic Lagos counterparties (Chowdeck, Bolt, IKEDC, etc). Returns the count + balance delta. After seeding, POST /api/v1/analysis/refresh to populate insights.',
  })
  seedTransactions(
    @Body() body: SeedTransactionsBodyDTO,
    @Req() req: CustomRequest,
  ) {
    return this.devService.seedTransactions(body, req);
  }

  @Delete(`${subRoutes.seedTransactions}${subRoutes.clear}`)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Wipe all transactions for the current user',
    description:
      'Dev-only. Deletes every transaction tied to the user and resets the account balance to 0.',
  })
  clearTransactions(@Req() req: CustomRequest) {
    return this.devService.clearTransactions(req);
  }

  @Post(subRoutes.seedCatalog)
  @HttpCode(201)
  @ApiOperation({
    summary: 'Seed the loan + investment + grant catalogs',
    description:
      'Dev-only. Idempotent — re-running only inserts products that don’t already exist (matched by provider + name).',
  })
  seedCatalog() {
    return this.devService.seedCatalog();
  }
}
