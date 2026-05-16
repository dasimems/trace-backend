import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OpportunitySourceEnum } from '@prisma/client';
import type { CustomRequest } from '@common/authentication/authentication.dto';
import { AuthGuard } from '@common/authentication/authentication.guard';
import { ApiOkResponseData } from '@common/response/api-response.decorator';
import {
  CostBreakdownResponseDTO,
  DocumentsResponseDTO,
  FaqResponseDTO,
  OpportunityPersonalizedDTO,
  OpportunitySimulationDTO,
} from '@common/response/opportunities/details.dto';
import { OpportunityDTO } from '@common/response/opportunities/opportunities.dto';
import { routes, subRoutes } from '@shared/variables';
import {
  GetOpportunitiesQueryDTO,
  SimulateQueryDTO,
} from './opportunities.dto';
import { OpportunitiesService } from './opportunities.service';

@ApiTags('Opportunities')
@ApiBearerAuth('access-token')
@UseGuards(AuthGuard)
@Controller(routes.opportunities)
export class OpportunitiesController {
  constructor(
    private readonly opportunitiesService: OpportunitiesService,
  ) {}

  @Get('/')
  @HttpCode(200)
  @ApiOperation({
    summary: 'List loans + investments + grants ranked by match',
  })
  @ApiOkResponseData(OpportunityDTO, { isArray: true })
  list(
    @Query() query: GetOpportunitiesQueryDTO,
    @Req() req: CustomRequest,
  ) {
    return this.opportunitiesService.list(query, req);
  }

  @Get('/:source/:id')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Get a single opportunity (resolved against source)',
    description:
      'source = LOAN | INVESTMENT | GRANT, id is the underlying record’s uuid.',
  })
  @ApiOkResponseData(OpportunityDTO)
  getOne(
    @Param(
      'source',
      new ParseEnumPipe(OpportunitySourceEnum),
    )
    source: OpportunitySourceEnum,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: CustomRequest,
  ) {
    return this.opportunitiesService.getOne(source, id, req);
  }

  @Post('/:source/:id/save')
  @HttpCode(201)
  @ApiOperation({ summary: 'Save an opportunity to the user’s watchlist' })
  save(
    @Param(
      'source',
      new ParseEnumPipe(OpportunitySourceEnum),
    )
    source: OpportunitySourceEnum,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: CustomRequest,
  ) {
    return this.opportunitiesService.save(source, id, req);
  }

  @Delete('/:source/:id/save')
  @HttpCode(200)
  @ApiOperation({ summary: 'Remove an opportunity from the watchlist' })
  unsave(
    @Param(
      'source',
      new ParseEnumPipe(OpportunitySourceEnum),
    )
    source: OpportunitySourceEnum,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: CustomRequest,
  ) {
    return this.opportunitiesService.unsave(source, id, req);
  }

  // ─── Detail panels (consumers on /app/opportunities/[id]) ─────────────

  @Get(`/:source/:id${subRoutes.simulate}`)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Run the cost/yield simulator for an opportunity',
    description:
      'For LOAN returns repayment figures; for INVESTMENT returns projected value at maturity; for GRANT returns a flat eligibility score.',
  })
  @ApiOkResponseData(OpportunitySimulationDTO)
  simulate(
    @Param('source', new ParseEnumPipe(OpportunitySourceEnum))
    source: OpportunitySourceEnum,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: SimulateQueryDTO,
  ) {
    return this.opportunitiesService.simulate(
      source,
      id,
      query.amount,
      query.tenorDays,
    );
  }

  @Get(`/:source/:id${subRoutes.personalized}`)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Personalized "what this means for me" stats + AI one-liner',
  })
  @ApiOkResponseData(OpportunityPersonalizedDTO)
  personalized(
    @Param('source', new ParseEnumPipe(OpportunitySourceEnum))
    source: OpportunitySourceEnum,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: CustomRequest,
  ) {
    return this.opportunitiesService.personalized(source, id, req);
  }

  @Get(`/:source/:id${subRoutes.costBreakdown}`)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Fees + interest + settlement breakdown',
    description:
      'For LOAN/INVESTMENT, computes amounts from the product template + the input amount. GRANT returns empty.',
  })
  @ApiOkResponseData(CostBreakdownResponseDTO)
  costBreakdown(
    @Param('source', new ParseEnumPipe(OpportunitySourceEnum))
    source: OpportunitySourceEnum,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: SimulateQueryDTO,
  ) {
    return this.opportunitiesService.costBreakdown(source, id, query.amount);
  }

  @Get(`/:source/:id${subRoutes.documents}`)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Required documents (per-product template + per-user upload state)',
  })
  @ApiOkResponseData(DocumentsResponseDTO)
  documents(
    @Param('source', new ParseEnumPipe(OpportunitySourceEnum))
    source: OpportunitySourceEnum,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: CustomRequest,
  ) {
    return this.opportunitiesService.documents(source, id, req);
  }

  @Get(`/:source/:id${subRoutes.faq}`)
  @HttpCode(200)
  @ApiOperation({ summary: 'Static FAQ entries for this opportunity' })
  @ApiOkResponseData(FaqResponseDTO)
  faq(
    @Param('source', new ParseEnumPipe(OpportunitySourceEnum))
    source: OpportunitySourceEnum,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.opportunitiesService.faq(source, id);
  }
}
