import {
    Body,
    Controller,
    Get,
    Post,
    Query,
    Req,
    UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from '@modules/auth/auth.service';
import {
    PaymentsService,
    type CreateCheckoutSessionRequestDto,
} from '@modules/payments/payments.service';
import { VnPayService } from '@modules/payments/vnpay/vnpay.service';

@Controller('payments')
export class PaymentsController {
    constructor(
        private readonly paymentsService: PaymentsService,
        private readonly authService: AuthService,
        private readonly vnpay: VnPayService,
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

    @Get('stripe/session-status')
    async getStripeSessionStatus(
        @Req() req: Request,
        @Query('sessionId') sessionId: string,
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

        return this.paymentsService.getStripeSessionStatus({
            accountId: decoded.accountId,
            sessionId,
        });
    }

    @Post('vnpay/create-payment-url')
    async createVnPayPaymentUrl(
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
        return this.vnpay.createPaymentUrl(decoded.accountId, body);
    }

    /**
     * Verify return-URL query (browser redirect from VNPAY). Public: security is the HMAC itself.
     * Client should pass all `vnp_*` query params unchanged.
     */
    @Get('vnpay/verify-return')
    verifyVnPayReturn(@Query() query: Record<string, string | undefined>) {
        return this.vnpay.verifyReturnQuery(query);
    }
}