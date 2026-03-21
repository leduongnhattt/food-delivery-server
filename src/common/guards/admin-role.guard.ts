import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import type { JwtPayload } from '@modules/auth/auth.service';

/**
 * Requires a valid JWT (run after {@link JwtAuthGuard}) and role Admin on the payload.
 */
@Injectable()
export class AdminRoleGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<Request & { account?: JwtPayload }>();
    const role = req.account?.role?.trim().toLowerCase();
    if (role !== 'admin') {
      throw new ForbiddenException('Admin access required');
    }
    return true;
  }
}
