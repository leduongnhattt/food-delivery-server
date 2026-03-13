import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { JwtPayload } from '@modules/auth/auth.service';

interface RequestWithAccount extends Request {
  account?: JwtPayload;
  user?: JwtPayload;
}

export const CurrentAccount = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload | null => {
    const request = ctx.switchToHttp().getRequest<RequestWithAccount>();
    return request.account ?? request.user ?? null;
  },
);
