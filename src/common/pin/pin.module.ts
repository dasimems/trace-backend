import { Global, Module } from '@nestjs/common';
import { PinService } from './pin.service';

@Global()
@Module({
  providers: [PinService],
  exports: [PinService],
})
export class PinModule {}
