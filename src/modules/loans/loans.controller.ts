import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CustomRequest } from '@common/authentication/authentication.dto';
import { AuthGuard } from '@common/authentication/authentication.guard';
import {
  ApiCreatedResponseData,
  ApiOkResponseData,
} from '@common/response/api-response.decorator';
import {
  LoanAffordabilityResponseDTO,
  LoanApplicationDTO,
  LoanProductDTO,
  LoanTierResponseDTO,
} from '@common/response/loans/loans.dto';
import { routes, subRoutes } from '@shared/variables';
import {
  AffordabilityQueryDTO,
  ApplyForLoanBodyDTO,
  GetLoanApplicationsQueryDTO,
} from './loans.dto';
import { LoansService } from './loans.service';

@ApiTags('Loans')
@ApiBearerAuth('access-token')
@UseGuards(AuthGuard)
@Controller(routes.loans)
export class LoansController {
  constructor(private readonly loansService: LoansService) {}

  @Get(subRoutes.tier)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Get the user’s loan tier + max exposure',
    description:
      'Derived from the same composite health score as /analysis/health. Returns status="insufficient_data" until 14 inflows and 14 days of activity accrue.',
  })
  @ApiOkResponseData(LoanTierResponseDTO)
  getTier(@Req() req: CustomRequest) {
    return this.loansService.getTier(req);
  }

  @Get(subRoutes.products)
  @HttpCode(200)
  @ApiOperation({
    summary: 'List loan products with eligibility flag per product',
  })
  @ApiOkResponseData(LoanProductDTO, { isArray: true })
  listProducts(@Req() req: CustomRequest) {
    return this.loansService.listProducts(req);
  }

  @Get(subRoutes.affordability)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Repayment simulator for a product + amount + tenor',
    description:
      'Returns the per-day / per-week repayment and an isAffordable flag (daily payment ≤30% of avg daily inflow).',
  })
  @ApiOkResponseData(LoanAffordabilityResponseDTO)
  getAffordability(
    @Query() query: AffordabilityQueryDTO,
    @Req() req: CustomRequest,
  ) {
    return this.loansService.getAffordability(query, req);
  }

  @Post(subRoutes.applications)
  @HttpCode(201)
  @ApiOperation({
    summary: 'Submit a loan application',
    description:
      'Creates a PENDING application. Disbursement happens out-of-band when a real lender is wired in.',
  })
  @ApiCreatedResponseData(LoanApplicationDTO)
  apply(@Body() body: ApplyForLoanBodyDTO, @Req() req: CustomRequest) {
    return this.loansService.apply(body, req);
  }

  @Get(subRoutes.applications)
  @HttpCode(200)
  @ApiOperation({ summary: 'List the user’s loan applications (paginated)' })
  @ApiOkResponseData(LoanApplicationDTO, { isArray: true })
  listApplications(
    @Query() query: GetLoanApplicationsQueryDTO,
    @Req() req: CustomRequest,
  ) {
    return this.loansService.listApplications(query, req);
  }

  @Get(`${subRoutes.applications}/:id`)
  @HttpCode(200)
  @ApiOperation({ summary: 'Get a single loan application' })
  @ApiOkResponseData(LoanApplicationDTO)
  getApplication(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: CustomRequest,
  ) {
    return this.loansService.getApplication(id, req);
  }
}
