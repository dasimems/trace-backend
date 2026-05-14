import {
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import type { CustomRequest } from '@common/authentication/authentication.dto';
import { AuthGuard } from '@common/authentication/authentication.guard';
import { SseAuthGuard } from '@common/authentication/sse-auth.guard';
import {
  CashFlowResponseDTO,
  CategoryTrendResponseDTO,
  MoneyFlowResponseDTO,
  SpendingBreakdownResponseDTO,
} from '@common/response/analysis/analysis.dto';
import { ApiOkResponseData } from '@common/response/api-response.decorator';
import { CachedInsightDTO } from '@common/response/insights/cached-insight.dto';
import {
  AnomaliesResponseDTO,
  HealthScoreResponseDTO,
  RecommendationsResponseDTO,
  RecurringResponseDTO,
  RiskStabilityResponseDTO,
  WeeklySummaryResponseDTO,
} from '@common/response/insights/insights.dto';
import { EventBusService } from '@common/events/event-bus.service';
import { routes, subRoutes } from '@shared/variables';
import { AnalysisJobsService } from './analysis-jobs.service';
import { WeeksQueryDTO } from './analysis.dto';
import { AnalysisService } from './analysis.service';
import { InsightsService } from './insights.service';

@ApiTags('Analysis')
@Controller(routes.analysis)
export class AnalysisController {
  constructor(
    private readonly analysisService: AnalysisService,
    private readonly insightsService: InsightsService,
    private readonly analysisJobs: AnalysisJobsService,
    private readonly eventBus: EventBusService,
  ) {}

  // ─── Fast aggregations (still synchronous — these are pure DB queries) ──

  @UseGuards(AuthGuard)
  @ApiBearerAuth('access-token')
  @Get(subRoutes.cashflow)
  @HttpCode(200)
  @ApiOperation({ summary: 'Weekly income vs spend (default 8 weeks)' })
  @ApiOkResponseData(CashFlowResponseDTO, {
    description: 'Weekly income/spend breakdown.',
  })
  cashflow(@Query() query: WeeksQueryDTO, @Req() req: CustomRequest) {
    const auth = this.analysisService.requireAuth(req);
    return this.analysisService.getCashflow(auth.id, query.weeks ?? 8);
  }

  @UseGuards(AuthGuard)
  @ApiBearerAuth('access-token')
  @Get(subRoutes.moneyFlow)
  @HttpCode(200)
  @ApiOperation({ summary: 'Weekly money in/out (default 4 weeks)' })
  @ApiOkResponseData(MoneyFlowResponseDTO, {
    description: 'Weekly in/out totals.',
  })
  moneyFlow(@Query() query: WeeksQueryDTO, @Req() req: CustomRequest) {
    const auth = this.analysisService.requireAuth(req);
    return this.analysisService.getMoneyFlow(auth.id, query.weeks ?? 4);
  }

  @UseGuards(AuthGuard)
  @ApiBearerAuth('access-token')
  @Get(subRoutes.spendingBreakdown)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Spending breakdown by category for the current month',
  })
  @ApiOkResponseData(SpendingBreakdownResponseDTO, {
    description: 'Per-category totals + percent share + grand total.',
  })
  spendingBreakdown(@Req() req: CustomRequest) {
    const auth = this.analysisService.requireAuth(req);
    return this.analysisService.getSpendingBreakdown(auth.id);
  }

  @UseGuards(AuthGuard)
  @ApiBearerAuth('access-token')
  @Get(subRoutes.categoryTrend)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Current-month spend vs prior 8-week average, by category',
  })
  @ApiOkResponseData(CategoryTrendResponseDTO, {
    description: 'Category-level current vs average comparison.',
  })
  categoryTrend(@Req() req: CustomRequest) {
    const auth = this.analysisService.requireAuth(req);
    return this.analysisService.getCategoryTrend(auth.id);
  }

  // ─── Insights — cached reads ────────────────────────────────────────────
  // These NEVER block on computation. They return `{ status: "fresh", value,
  // lastUpdated }` if the cache has data, or `{ status: "pending", value:
  // null }` otherwise. To populate the cache, POST /analysis/refresh.

  @UseGuards(AuthGuard)
  @ApiBearerAuth('access-token')
  @Get(subRoutes.health)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Cached financial health score',
    description:
      'Reads from cache only — never runs the scoring engine in the request path. POST /analysis/refresh to populate, then listen on /analysis/stream for updates.',
  })
  @ApiOkResponseData(CachedInsightDTO<HealthScoreResponseDTO>, {
    description: 'Cached health insight wrapper.',
  })
  health(@Req() req: CustomRequest) {
    return this.insightsService.getHealthCached(req);
  }

  @UseGuards(AuthGuard)
  @ApiBearerAuth('access-token')
  @Get(subRoutes.riskStability)
  @HttpCode(200)
  @ApiOperation({ summary: 'Cached risk & stability sub-scores' })
  @ApiOkResponseData(CachedInsightDTO<RiskStabilityResponseDTO>, {
    description: 'Cached risk insight wrapper.',
  })
  riskStability(@Req() req: CustomRequest) {
    return this.insightsService.getRiskStabilityCached(req);
  }

  @UseGuards(AuthGuard)
  @ApiBearerAuth('access-token')
  @Get(subRoutes.recurring)
  @HttpCode(200)
  @ApiOperation({ summary: 'Cached recurring patterns' })
  @ApiOkResponseData(CachedInsightDTO<RecurringResponseDTO>, {
    description: 'Cached recurring insight wrapper.',
  })
  recurring(@Req() req: CustomRequest) {
    return this.insightsService.getRecurringCached(req);
  }

  @UseGuards(AuthGuard)
  @ApiBearerAuth('access-token')
  @Get(subRoutes.anomalies)
  @HttpCode(200)
  @ApiOperation({ summary: 'Cached anomalies' })
  @ApiOkResponseData(CachedInsightDTO<AnomaliesResponseDTO>, {
    description: 'Cached anomalies insight wrapper.',
  })
  anomalies(@Req() req: CustomRequest) {
    return this.insightsService.getAnomaliesCached(req);
  }

  @UseGuards(AuthGuard)
  @ApiBearerAuth('access-token')
  @Get(subRoutes.summary)
  @HttpCode(200)
  @ApiOperation({ summary: 'Cached weekly AI summary bullets' })
  @ApiOkResponseData(CachedInsightDTO<WeeklySummaryResponseDTO>, {
    description: 'Cached summary insight wrapper.',
  })
  summary(@Req() req: CustomRequest) {
    return this.insightsService.getWeeklySummaryCached(req);
  }

  @UseGuards(AuthGuard)
  @ApiBearerAuth('access-token')
  @Get(subRoutes.recommendations)
  @HttpCode(200)
  @ApiOperation({ summary: 'Cached recommendations' })
  @ApiOkResponseData(CachedInsightDTO<RecommendationsResponseDTO>, {
    description: 'Cached recommendations insight wrapper.',
  })
  recommendations(@Req() req: CustomRequest) {
    return this.insightsService.getRecommendationsCached(req);
  }

  // ─── Refresh + Stream ──────────────────────────────────────────────────

  @UseGuards(AuthGuard)
  @ApiBearerAuth('access-token')
  @Post(subRoutes.refresh)
  @HttpCode(202)
  @ApiOperation({
    summary: 'Kick off a background refresh of all 6 insight topics',
    description:
      'Returns 202 immediately. Subscribe to GET /analysis/stream to receive `analysis.<topic>.completed` events with the new payloads as they arrive. If a refresh is already running for this user, returns `{ started: false }`.',
  })
  refresh(@Req() req: CustomRequest) {
    const auth = this.insightsService.requireAuth(req);
    const result = this.analysisJobs.refresh(auth.id);
    return { started: result.started };
  }

  @UseGuards(SseAuthGuard)
  // Documented separately from @ApiBearerAuth because SSE accepts either
  // header OR ?token= query (native EventSource limitation).
  @Get(subRoutes.stream)
  @Header('Content-Type', 'text/event-stream')
  @Header('Cache-Control', 'no-cache, no-transform')
  @Header('Connection', 'keep-alive')
  // Tells nginx / cloud proxies to stream rather than buffer.
  @Header('X-Accel-Buffering', 'no')
  @ApiOperation({
    summary: 'SSE stream of analysis events for the current user',
    description:
      'Server-Sent Events. Emits `analysis.refresh.started`, `analysis.<topic>.completed` (one per topic, with full payload), `analysis.<topic>.failed`, and `analysis.refresh.completed`. Auth: header `Authorization: Bearer <token>` OR query `?token=<token>` (the latter is required for browser native EventSource).',
  })
  stream(@Req() req: CustomRequest, @Res() res: FastifyReply) {
    const auth = this.insightsService.requireAuth(req);
    const raw = res.raw;

    // Send headers immediately — some clients won't fire `open` until they
    // see them, and Fastify defers writing until first body write otherwise.
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // SSE comment line — ignored by the parser but exercises the pipe so
    // intermediaries don't drop a "connecting" connection.
    raw.write(`: connected ${new Date().toISOString()}\n\n`);

    const unsubscribe = this.eventBus.subscribe(auth.id, (event) => {
      // SSE wire format: each event = `event:` line, `data:` line(s), blank
      // line terminator. JSON is single-line so no special handling needed.
      try {
        raw.write(`event: ${event.type}\n`);
        raw.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch {
        // Client closed mid-write — close() handler will clean up.
      }
    });

    // Comment-line heartbeat. Some proxies kill idle connections at 30–60s;
    // 15s is well under that.
    const heartbeat = setInterval(() => {
      try {
        raw.write(`: heartbeat ${Date.now()}\n\n`);
      } catch {
        // ignore
      }
    }, 15000);

    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };

    req.raw.on('close', cleanup);
    req.raw.on('error', cleanup);

    // Don't return anything — keep the response open. The global response
    // interceptor will not run (we used @Res() in non-passthrough mode).
  }
}
