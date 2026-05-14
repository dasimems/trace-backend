import { Injectable, Logger } from '@nestjs/common';
import { EventBusService } from '@common/events/event-bus.service';
import {
  AnalysisTopic,
  AnalysisRefreshCompletedPayload,
  AnalysisRefreshSkippedPayload,
  AnalysisRefreshStartedPayload,
} from '@common/response/insights/insights-event.dto';
import { ScoringTransaction } from '@common/scoring/scoring.types';
import { InsightsService } from './insights.service';

const ALL_TOPICS: AnalysisTopic[] = [
  'health',
  'risk-stability',
  'recurring',
  'anomalies',
  'summary',
  'recommendations',
];

@Injectable()
export class AnalysisJobsService {
  private readonly logger = new Logger(AnalysisJobsService.name);

  // Per-user dedupe. If a refresh is already running for a user, the second
  // request is a no-op and emits `analysis.refresh.skipped`. In-process only —
  // for multi-instance horizontal scaling, swap this for a Redis SETNX lock.
  private readonly inProgress = new Set<string>();

  constructor(
    private readonly insights: InsightsService,
    private readonly eventBus: EventBusService,
  ) {}

  // Kicks off a full refresh and returns immediately. The HTTP handler that
  // calls this responds with 202 — the work continues in the background and
  // event subscribers see results trickle in as each topic completes.
  refresh(userId: string): { started: boolean } {
    if (this.inProgress.has(userId)) {
      this.eventBus.publish<AnalysisRefreshSkippedPayload>(userId, {
        type: 'analysis.refresh.skipped',
        payload: { reason: 'already_running' },
      });
      return { started: false };
    }

    this.inProgress.add(userId);
    this.eventBus.publish<AnalysisRefreshStartedPayload>(userId, {
      type: 'analysis.refresh.started',
      payload: { topics: ALL_TOPICS },
    });

    // Run in the background — do NOT await. The setImmediate handoff makes
    // sure the calling HTTP handler returns before any compute happens.
    setImmediate(() => {
      void this.runAll(userId);
    });

    return { started: true };
  }

  private async runAll(userId: string): Promise<void> {
    const startedAt = Date.now();
    try {
      const { transactions, balance } = await this.insights.loadContext(userId);

      // Fan out all 6 topics in parallel. allSettled so one failure (e.g.
      // Claude rate-limit on the summary) doesn't take down the rest.
      await Promise.allSettled([
        this.runTopic(userId, 'health', () =>
          Promise.resolve(this.insights.computeHealth(transactions, balance)),
        ),
        this.runTopic(userId, 'risk-stability', () =>
          Promise.resolve(
            this.insights.computeRiskStabilityFor(transactions, balance),
          ),
        ),
        this.runTopic(userId, 'recurring', () =>
          Promise.resolve(this.insights.computeRecurringFor(transactions)),
        ),
        this.runTopic(userId, 'anomalies', () =>
          Promise.resolve(this.insights.computeAnomaliesFor(transactions)),
        ),
        this.runTopic(userId, 'summary', () =>
          this.insights.computeWeeklySummaryFor(transactions, balance),
        ),
        this.runTopic(userId, 'recommendations', () =>
          this.insights.computeRecommendationsFor(transactions, balance),
        ),
      ]);

      this.eventBus.publish<AnalysisRefreshCompletedPayload>(userId, {
        type: 'analysis.refresh.completed',
        payload: {
          topics: ALL_TOPICS,
          durationMs: Date.now() - startedAt,
        },
      });
    } catch (error) {
      // loadContext failed (e.g. DB error). Emit a generic failure on each
      // topic so the frontend doesn't sit on `pending` forever.
      const message = (error as Error).message;
      this.logger.error(`runAll failed for user=${userId}: ${message}`);
      for (const topic of ALL_TOPICS) {
        this.eventBus.publish(userId, {
          type: `analysis.${topic}.failed`,
          payload: { topic, message },
        });
      }
    } finally {
      this.inProgress.delete(userId);
    }
  }

  // Runs a single topic, writes the cache, and publishes either the completed
  // event (with the full payload) or the failed event.
  private async runTopic<T>(
    userId: string,
    topic: AnalysisTopic,
    compute: () => Promise<T>,
  ): Promise<void> {
    try {
      const value = await compute();
      await this.insights.writeCache(topic, userId, value);
      this.eventBus.publish<T>(userId, {
        type: `analysis.${topic}.completed`,
        payload: value,
      });
    } catch (error) {
      const message = (error as Error).message;
      this.logger.warn(`topic=${topic} user=${userId} failed: ${message}`);
      this.eventBus.publish(userId, {
        type: `analysis.${topic}.failed`,
        payload: { topic, message },
      });
    }
  }

  isRunning(userId: string): boolean {
    return this.inProgress.has(userId);
  }
}
