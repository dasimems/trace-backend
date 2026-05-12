import { Global, Module } from '@nestjs/common';
import Keyv from 'keyv';
import { CacheableMemory } from 'cacheable';
import { ConfigService } from '@nestjs/config';
import KeyvRedis from '@keyv/redis';
import {
  MEMORY_CACHE,
  REDIS_CACHE,
  REDIS_CONNECTION_STRING,
} from '../../shared/constants';

@Global()
@Module({
  providers: [
    {
      provide: MEMORY_CACHE,
      useFactory: () => {
        return new Keyv({
          store: new CacheableMemory({
            ttl: 5 * 60 * 1000,
          }),
        });
      },
    },
    {
      provide: REDIS_CACHE,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const redisUrl = configService.get<string>(REDIS_CONNECTION_STRING);
        return new Keyv({ store: new KeyvRedis(redisUrl), ttl: 60000 });
      },
    },
  ],
  exports: [MEMORY_CACHE, REDIS_CACHE],
})
export class CacheModule {}
