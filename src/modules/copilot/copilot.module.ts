import { Module } from '@nestjs/common';
import { AnalysisModule } from '@modules/analysis/analysis.module';
import { CopilotController } from './copilot.controller';
import { CopilotService } from './copilot.service';

@Module({
  imports: [AnalysisModule],
  controllers: [CopilotController],
  providers: [CopilotService],
})
export class CopilotModule {}
