import { CanActivate, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NODE_ENV } from '@shared/constants';
import { NodeEnv } from '@shared/enums/enums';

// Hard wall in front of every dev endpoint. Even if someone accidentally
// ships the route to production, this guard refuses to let it run.
@Injectable()
export class NonProductionGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(): boolean {
    const env = this.configService.get<string>(NODE_ENV);
    if (env === NodeEnv.PRODUCTION) {
      throw new ForbiddenException(
        'Dev endpoints are not available in production.',
      );
    }
    return true;
  }
}
