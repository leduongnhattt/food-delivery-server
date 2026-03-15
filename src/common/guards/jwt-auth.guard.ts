import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService, type JwtPayload } from '@modules/auth/auth.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<Request & { account?: JwtPayload }>();
    const path = (req.url || req.path || '').split('?')[0];
    // Allow refresh (and other auth public routes) without requiring valid JWT
    if (path.endsWith('/auth/refresh') || path.endsWith('/auth/login') || path.endsWith('/auth/register')) {
      return true;
    }

    const authHeader = req.headers['authorization'];
    const token =
      typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.replace('Bearer ', '')
        : '';

    if (!token) {
      throw new UnauthorizedException('Unauthorized');
    }

    const decoded = this.authService.verifyAccessToken(token);
    if (!decoded) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    req.account = decoded;
    return true;
  }
}
