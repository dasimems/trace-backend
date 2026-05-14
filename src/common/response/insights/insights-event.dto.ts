import {
  AnomaliesResponseDTO,
  HealthScoreResponseDTO,
  RecommendationsResponseDTO,
  RecurringResponseDTO,
  RiskStabilityResponseDTO,
  WeeklySummaryResponseDTO,
} from './insights.dto';

export type AnalysisTopic =
  | 'health'
  | 'risk-stability'
  | 'recurring'
  | 'anomalies'
  | 'summary'
  | 'recommendations';

export type AnalysisEventType =
  | `analysis.${AnalysisTopic}.completed`
  | `analysis.${AnalysisTopic}.failed`
  | 'analysis.refresh.started'
  | 'analysis.refresh.completed'
  | 'analysis.refresh.skipped';

// Map of topic → payload type. Used to type-narrow SSE events on the client.
export interface AnalysisCompletedPayloads {
  health: HealthScoreResponseDTO;
  'risk-stability': RiskStabilityResponseDTO;
  recurring: RecurringResponseDTO;
  anomalies: AnomaliesResponseDTO;
  summary: WeeklySummaryResponseDTO;
  recommendations: RecommendationsResponseDTO;
}

export interface AnalysisFailurePayload {
  topic: AnalysisTopic;
  message: string;
}

export interface AnalysisRefreshStartedPayload {
  topics: AnalysisTopic[];
}

export interface AnalysisRefreshCompletedPayload {
  topics: AnalysisTopic[];
  durationMs: number;
}

export interface AnalysisRefreshSkippedPayload {
  reason: 'already_running';
}
