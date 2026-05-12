import { Global, Module } from '@nestjs/common';
import { UrlService } from './url.service';

@Global()
@Module({
  providers: [UrlService],
  exports: [UrlService],
})
export class UrlModule {}
