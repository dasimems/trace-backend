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
  DistributionsResponseDTO,
  NavHistoryResponseDTO,
  NavSnapshotDTO,
  SectorAllocationResponseDTO,
} from '@common/response/investments/details.dto';
import {
  InvestmentAllocationDTO,
  InvestmentProductDTO,
  PortfolioResponseDTO,
  SafeToInvestResponseDTO,
} from '@common/response/investments/investments.dto';
import { routes, subRoutes } from '@shared/variables';
import {
  AllocateBodyDTO,
  DistributionsQueryDTO,
  GetAllocationsQueryDTO,
  NavHistoryQueryDTO,
} from './investments.dto';
import { InvestmentsService } from './investments.service';

@ApiTags('Investments')
@ApiBearerAuth('access-token')
@UseGuards(AuthGuard)
@Controller(routes.investments)
export class InvestmentsController {
  constructor(private readonly investmentsService: InvestmentsService) {}

  @Get(subRoutes.products)
  @HttpCode(200)
  @ApiOperation({ summary: 'List active investment products' })
  @ApiOkResponseData(InvestmentProductDTO, { isArray: true })
  listProducts(@Req() req: CustomRequest) {
    return this.investmentsService.listProducts(req);
  }

  @Get(subRoutes.portfolio)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Get the user’s portfolio (holdings + active allocations)',
  })
  @ApiOkResponseData(PortfolioResponseDTO)
  getPortfolio(@Req() req: CustomRequest) {
    return this.investmentsService.getPortfolio(req);
  }

  @Get('/safe-to-invest')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Conservative / suggested / aggressive allocation suggestions',
  })
  @ApiOkResponseData(SafeToInvestResponseDTO)
  getSafeToInvest(@Req() req: CustomRequest) {
    return this.investmentsService.getSafeToInvest(req);
  }

  @Post('/allocations')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Allocate funds to an investment product',
    description:
      'Reserves the amount from the user’s account balance and creates a PENDING allocation. Settlement to ACTIVE happens out-of-band when a real provider is wired in.',
  })
  @ApiCreatedResponseData(InvestmentAllocationDTO)
  allocate(@Body() body: AllocateBodyDTO, @Req() req: CustomRequest) {
    return this.investmentsService.allocate(body, req);
  }

  @Get('/allocations')
  @HttpCode(200)
  @ApiOperation({ summary: 'List the user’s allocations (paginated)' })
  @ApiOkResponseData(InvestmentAllocationDTO, { isArray: true })
  listAllocations(
    @Query() query: GetAllocationsQueryDTO,
    @Req() req: CustomRequest,
  ) {
    return this.investmentsService.listAllocations(query, req);
  }

  // ─── Product detail panels ────────────────────────────────────────────

  @Get(`${subRoutes.products}/:id${subRoutes.navHistory}`)
  @HttpCode(200)
  @ApiOperation({
    summary: 'NAV history points for the performance chart',
    description:
      'Period: 1Y (default), 3Y, or YTD. NAV per unit in kobo. Seeded data — no live market feed wired.',
  })
  @ApiOkResponseData(NavHistoryResponseDTO)
  navHistory(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: NavHistoryQueryDTO,
  ) {
    return this.investmentsService.getNavHistory(id, query.period ?? '1Y');
  }

  @Get(`${subRoutes.products}/:id${subRoutes.nav}`)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Current NAV snapshot + 24h and YTD deltas',
  })
  @ApiOkResponseData(NavSnapshotDTO)
  navSnapshot(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.investmentsService.getNavSnapshot(id);
  }

  @Get(`${subRoutes.products}/:id${subRoutes.sectorAllocation}`)
  @HttpCode(200)
  @ApiOperation({ summary: 'Sector breakdown for the fund' })
  @ApiOkResponseData(SectorAllocationResponseDTO)
  sectorAllocation(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.investmentsService.getSectorAllocation(id);
  }

  @Get(`${subRoutes.products}/:id${subRoutes.distributions}`)
  @HttpCode(200)
  @ApiOperation({ summary: 'Recent payouts (newest first)' })
  @ApiOkResponseData(DistributionsResponseDTO)
  distributions(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: DistributionsQueryDTO,
  ) {
    return this.investmentsService.getDistributions(id, query.limit ?? 12);
  }
}
