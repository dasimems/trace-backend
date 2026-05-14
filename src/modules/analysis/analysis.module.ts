import { Module } from '@nestjs/common';
import { AnalysisJobsService } from './analysis-jobs.service';
import { AnalysisController } from './analysis.controller';
import { AnalysisService } from './analysis.service';
import { InsightsService } from './insights.service';

@Module({
  controllers: [AnalysisController],
  providers: [AnalysisService, InsightsService, AnalysisJobsService],
})
export class AnalysisModule {}
