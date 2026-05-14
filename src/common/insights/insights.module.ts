import { Global, Module } from '@nestjs/common';
import { RationaleService } from './rationale.service';

@Global()
@Module({
  providers: [RationaleService],
  exports: [RationaleService],
})
export class InsightsCommonModule {}
