import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthenticationService } from './authentication.service';
import { CustomRequest } from './authentication.dto';

// SSE-only guard. Like AuthGuard but ALSO accepts the token in the `?token=`
// query string — browsers' native EventSource cannot set custom headers, so
// query-param auth is the standard SSE pattern. Use this ONLY on SSE routes:
// query tokens leak into logs/referrers, so we don't enable them globally.
@Injectable()
export class SseAuthGuard implements CanActivate {
  constructor(
    private readonly authenticationService: AuthenticationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<CustomRequest>();

    let token = this.authenticationService.getUserToken(request, false);
    if (!token) {
      const queryToken = (
        request.query as Record<string, string | undefined> | undefined
      )?.token;
      if (typeof queryToken === 'string' && queryToken.length > 0) {
        token = queryToken;
      }
    }

    if (!token) {
      throw new UnauthorizedException('Unauthorized!');
    }

    const decoded = await this.authenticationService.verifyToken(
      request,
      token,
    );
    request.auth = decoded;
    return true;
  }
}
