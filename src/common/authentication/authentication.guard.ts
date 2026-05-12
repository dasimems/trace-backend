import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { AuthenticationService } from './authentication.service';
import { CustomRequest } from './authentication.dto';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private authenticationService: AuthenticationService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<CustomRequest>();

    const token = this.authenticationService.getUserToken(request)!;
    if (request.auth) {
      return true;
    }

    const decoded = await this.authenticationService.verifyToken(
      request,
      token,
    );
    request.auth = decoded;
    return true;
  }
}

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<CustomRequest>();
    const user = request.auth;

    if (!user || user?.role?.toLowerCase() !== 'admin') {
      throw new ForbiddenException('Forbidden');
    }

    return true;
  }
}

/** Like AuthGuard but never throws — attaches `request.auth` if a valid token is present, otherwise lets the request through anonymously. */
@Injectable()
export class FreeGuard implements CanActivate {
  constructor(private readonly authenticationService: AuthenticationService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<CustomRequest>();

    const token = this.authenticationService.getUserToken(request, false);
    if (!token) {
      return true;
    }
    const decoded = await this.authenticationService.verifyToken(
      request,
      token,
      false,
    );
    if (!decoded) {
      return true;
    }

    request.auth = decoded;

    return true;
  }
}
