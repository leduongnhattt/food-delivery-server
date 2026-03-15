import {
    Body,
    Controller,
    Post,
    Req,
    UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from '@modules/auth/auth.service';
import {
    PaymentsService,
    type CreateCheckoutSessionRequestDto,
} from '@modules/payments/payments.service';

@Controller('payments')
export class PaymentsController {
    constructor(
        private readonly paymentsService: PaymentsService,
        private readonly authService: AuthService,
    ) { }

    @Post('create-checkout-session')
    async createCheckoutSession(
        @Req() req: Request,
        @Body() body: CreateCheckoutSessionRequestDto,
    ) {
        const authHeader = req.headers['authorization'];
        const token = authHeader?.replace(/^Bearer\s+/i, '');
        if (!token) {
            throw new UnauthorizedException('Unauthorized');
        }
        const decoded = this.authService.verifyAccessToken(token);
        if (!decoded?.accountId) {
            throw new UnauthorizedException('Invalid or expired token');
        }

        return this.paymentsService.createCheckoutSession(decoded.accountId, body);
    }

    @Post('process-checkout-success')
    async processCheckoutSuccess(
        @Req() req: Request,
        @Body() body: { sessionId: string },
    ) {
        const authHeader = req.headers['authorization'];
        const token = authHeader?.replace(/^Bearer\s+/i, '');
        if (!token) {
            throw new UnauthorizedException('Unauthorized');
        }
        const decoded = this.authService.verifyAccessToken(token);
        if (!decoded?.accountId) {
            throw new UnauthorizedException('Invalid or expired token');
        }

        return this.paymentsService.processCheckoutSuccess({
            accountId: decoded.accountId,
            sessionId: body.sessionId,
        });
    }

    @Post('store-cart-data')
    storeCartData(
        @Body()
        body: {
            sessionId: string;
            cartItems: unknown[];
            deliveryInfo?: { phone?: string; address?: string };
            voucherCode?: string;
            total?: number;
        },
    ) {
        // No auth required in legacy implementation; keep behavior for parity.
        return this.paymentsService.storeCartData(body);
    }
}