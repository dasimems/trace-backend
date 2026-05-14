import { Global, Module } from '@nestjs/common';
import { SquadService } from './squad.service';

@Global()
@Module({
  providers: [SquadService],
  exports: [SquadService],
})
export class SquadModule {}
