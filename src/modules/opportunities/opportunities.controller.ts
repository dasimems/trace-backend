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
import { OpportunityDTO } from '@common/response/opportunities/opportunities.dto';
import { routes } from '@shared/variables';
import { GetOpportunitiesQueryDTO } from './opportunities.dto';
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
}
