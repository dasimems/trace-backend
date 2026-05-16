import { Module } from '@nestjs/common';
import { LoansAutoDeductionService } from './loans-auto-deduction.service';
import { LoansController } from './loans.controller';
import { LoansService } from './loans.service';

@Module({
  controllers: [LoansController],
  providers: [LoansService, LoansAutoDeductionService],
  exports: [LoansAutoDeductionService],
})
export class LoansModule {}
