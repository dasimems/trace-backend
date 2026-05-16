import { Module } from '@nestjs/common';
import { LoansModule } from '@modules/loans/loans.module';
import { DevController } from './dev.controller';
import { DevService } from './dev.service';

@Module({
  imports: [LoansModule],
  controllers: [DevController],
  providers: [DevService],
})
export class DevModule {}
