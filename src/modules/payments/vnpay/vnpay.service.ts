import { BadRequestException, Injectable } from '@nestjs/common';
import crypto from 'crypto';
import { UsdVndExchangeRateService } from '@infra/exchange-rate/usd-vnd-exchange-rate.service';
import { PrismaService } from '@infra/prisma/prisma.service';
import type { CreateCheckoutSessionRequestDto } from '@modules/payments/dto';
import { ORDER_STATUS, PAYMENT_STATUS } from '@common/constants/order-payment-status.constants';
import { PAYMENT_PROVIDER } from '@common/constants/payment-provider.constants';
import { PAYMENT_METHOD } from '@common/constants/payment-method.constants';
import { formatVnpCreateDateCompact, sanitizeVnpOrderDescription } from '@modules/payments/vnpay/utils/vnpay-format.util';
import { EtaService } from '@modules/shipping/eta.service';
import { CommissionSettlementService } from '@modules/payments/commission-settlement/commission-settlement.service';
import {
  loadAccountCurrencyCode,
  loadEnterpriseDisplayNameFromFirstCartItem,
} from '@modules/payments/vnpay/utils/vnpay-payment-context.lookup';
import { invalidateEnterpriseOrderCaches } from '@modules/enterprise/orders/enterprise-order-cache.util';
import { getKeyJson, setKeyJson } from '@infra/redis/redis.service';
import {
  buildVnpSignablePayloadString,
  collectVnpQueryFieldsForSignature,
  computeVnpHmacSha512Hex,
  sortVnpParameterKeysLexicographically,
} from '@modules/payments/vnpay/utils/vnpay-signature.util';

type VnpIpnQueryParams = Record<string, string | undefined>;

type VnpPayGatewayEnvConfig = {
  tmnCode: string;
  hashSecret: string;
  vnpUrl: string;
  returnUrl: string;
};

type VnpPayAttempt = {
  paymentId: string; // also used as vnp_TxnRef
  accountId: string;
  customerId: string;
  dto: CreateCheckoutSessionRequestDto;
  accountCurrency: string;
  amountVnd: number;
  exchangeRateVndPerUsd: number;
  fxQuoteHost: string;
  enterpriseDisplayName: string;
  enterpriseId?: string | null;
  createdAtIso: string;
  status: 'created' | 'paid' | 'failed';
  orderId?: string | null;
  ipn?: VnpIpnQueryParams;
};

@Injectable()
export class VnPayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usdVndExchangeRate: UsdVndExchangeRateService,
    private readonly etaService: EtaService,
    private readonly commissionSettlement: CommissionSettlementService,
  ) { }

  private vnpAttemptKey(paymentId: string) {
    return `vnpay:attempt:${paymentId}`;
  }

  private attemptTtlSeconds(): number {
    const raw = process.env.VNP_ATTEMPT_TTL_SECONDS;
    const n = raw ? Number(raw) : 60 * 60; // 1h
    if (!Number.isFinite(n) || n <= 0) return 60 * 60;
    return Math.floor(n);
  }

  async resolveAttempt(txnRef: string): Promise<{ found: boolean; status?: VnpPayAttempt['status']; orderId?: string | null }> {
    if (!txnRef) return { found: false };
    const attempt = await getKeyJson<VnpPayAttempt>(this.vnpAttemptKey(txnRef));
    if (!attempt) return { found: false };
    return { found: true, status: attempt.status, orderId: attempt.orderId ?? null };
  }

  async createPaymentUrl(accountId: string, dto: CreateCheckoutSessionRequestDto) {
    const gatewayEnv = this.loadVnpGatewayEnv();
    this.assertValidCheckoutPayload(dto);

    const customerId = await this.requireCustomerIdForAccount(accountId);
    const accountCurrency = await loadAccountCurrencyCode(this.prisma, accountId);
    const enterpriseDisplayName = await loadEnterpriseDisplayNameFromFirstCartItem(
      this.prisma,
      dto,
    );
    const { amountVnd, exchangeRateVndPerUsd, fxQuoteHost } =
      await this.computeVnpAmountVnd({
        cartTotal: Number(dto.total),
        accountCurrency,
      });
    const paymentId = crypto.randomUUID();
    const enterpriseId = dto.cartItems?.[0]?.menuItem?.restaurantId;
    const attempt: VnpPayAttempt = {
      paymentId,
      accountId,
      customerId,
      dto,
      accountCurrency,
      amountVnd,
      exchangeRateVndPerUsd,
      fxQuoteHost,
      enterpriseDisplayName,
      enterpriseId: enterpriseId || null,
      createdAtIso: new Date().toISOString(),
      status: 'created',
      orderId: null,
    };
    await setKeyJson(this.vnpAttemptKey(paymentId), attempt, this.attemptTtlSeconds());

    const paymentRedirectUrl = this.buildSignedVnpPaymentRedirectUrl(gatewayEnv, {
      paymentId,
      amountVnd,
      orderDescription: sanitizeVnpOrderDescription(
        `Payment at ${enterpriseDisplayName} — Txn ${paymentId}`,
      ),
    });

    return { url: paymentRedirectUrl, paymentId };
  }

  private loadVnpGatewayEnv(): VnpPayGatewayEnvConfig {
    const tmnCode = process.env.VNP_TMNCODE?.trim();
    const hashSecret = process.env.VNP_HASH_SECRET?.trim();
    const vnpUrl = process.env.VNP_URL?.trim();
    const returnUrl = process.env.VNP_RETURN_URL?.trim();

    if (!tmnCode || !hashSecret || !vnpUrl || !returnUrl) {
      throw new BadRequestException('VNPAY is not configured');
    }

    return { tmnCode, hashSecret, vnpUrl, returnUrl };
  }

  private assertValidCheckoutPayload(dto: CreateCheckoutSessionRequestDto): void {
    if (!Array.isArray(dto.cartItems) || dto.cartItems.length === 0) {
      throw new BadRequestException('Cart items are required');
    }
    if (!dto.deliveryInfo?.address) {
      throw new BadRequestException('Delivery address is required');
    }
    if (dto.total == null || Number(dto.total) <= 0) {
      throw new BadRequestException('Total must be > 0');
    }
  }

  private async requireCustomerIdForAccount(accountId: string): Promise<string> {
    const customer = await this.prisma.customer.findUnique({
      where: { AccountID: accountId },
      select: { CustomerID: true },
    });
    if (!customer) {
      throw new BadRequestException('Customer not found');
    }
    return customer.CustomerID;
  }

  private async computeVnpAmountVnd(input: {
    cartTotal: number;
    accountCurrency: string;
  }): Promise<{
    amountVnd: number;
    exchangeRateVndPerUsd: number;
    fxQuoteHost: string;
  }> {
    const cartTotal = Number(input.cartTotal);
    if (!Number.isFinite(cartTotal) || cartTotal <= 0) {
      throw new BadRequestException('Total must be > 0');
    }

    const normalizedCurrency = (input.accountCurrency || '').toUpperCase();
    if (normalizedCurrency === 'VND') {
      return {
        amountVnd: Math.round(cartTotal),
        exchangeRateVndPerUsd: 1,
        fxQuoteHost: 'vnd_cart_total',
      };
    }

    const quote = await this.usdVndExchangeRate.getUsdToVndExchangeRate();
    return {
      amountVnd: Math.round(cartTotal * quote.vndPerUsd),
      exchangeRateVndPerUsd: quote.vndPerUsd,
      fxQuoteHost: quote.fxQuoteHost,
    };
  }

  private async createOrderAfterVnpSuccess(attempt: VnpPayAttempt, ipnQuery: VnpIpnQueryParams): Promise<string> {
    const dto = attempt.dto;
    const createdOrderId = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          CustomerID: attempt.customerId,
          VoucherID: null,
          TotalAmount: dto.total,
          DeliveryAddress: dto.deliveryInfo.address,
          DeliveryNote: '',
          Status: ORDER_STATUS.Pending,
          Metadata: {
            provider: PAYMENT_PROVIDER.VnPay,
            accountId: attempt.accountId,
            voucherCode: dto.voucherCode || null,
            phone: dto.deliveryInfo.phone || null,
            currency: attempt.accountCurrency,
            vnpay: {
              enterpriseName: attempt.enterpriseDisplayName,
              amountVnd: attempt.amountVnd,
              usdToVndRate: attempt.exchangeRateVndPerUsd,
              fxQuoteHost: attempt.fxQuoteHost,
            },
          },
          orderDetails: {
            create: dto.cartItems.map((item) => ({
              FoodID: item.menuItem.id,
              SubTotal: item.menuItem.price * item.quantity,
              Quantity: item.quantity,
            })),
          },
        },
        select: { OrderID: true },
      });

      await tx.payment.create({
        data: {
          PaymentID: attempt.paymentId,
          OrderID: order.OrderID,
          PaymentStatus: PAYMENT_STATUS.Completed,
          PaymentMethod: PAYMENT_METHOD.VNPay,
          TransactionID: attempt.paymentId,
          TransactionData: {
            provider: PAYMENT_PROVIDER.VnPay,
            createdAt: attempt.createdAtIso,
            ipn: ipnQuery,
            enterpriseName: attempt.enterpriseDisplayName,
            currency: attempt.accountCurrency,
            amountVnd: attempt.amountVnd,
            usdToVndRate: attempt.exchangeRateVndPerUsd,
            fxQuoteHost: attempt.fxQuoteHost,
          },
        },
      });

      return order.OrderID;
    });

    if (attempt.enterpriseId) {
      await this.etaService.computeAndPersistForOrder({
        orderId: createdOrderId,
        enterpriseId: attempt.enterpriseId,
        deliveryInfo: {
          address: attempt.dto.deliveryInfo.address,
          lat: attempt.dto.deliveryInfo.lat,
          lng: attempt.dto.deliveryInfo.lng,
        },
      }).catch(() => undefined);
      await invalidateEnterpriseOrderCaches(attempt.enterpriseId).catch(() => undefined);
    }

    return createdOrderId;
  }

  private buildSignedVnpPaymentRedirectUrl(
    gatewayEnv: VnpPayGatewayEnvConfig,
    input: {
      paymentId: string;
      amountVnd: number;
      orderDescription: string;
    },
  ): string {
    const vnpAmountMinorUnits = Math.round(Number(input.amountVnd) * 100);
    const createdAt = new Date();
    const clientIpPlaceholder = '127.0.0.1';

    const redirectQueryParams: Record<string, string> = {
      vnp_Version: '2.1.0',
      vnp_Command: 'pay',
      vnp_TmnCode: gatewayEnv.tmnCode,
      vnp_Amount: String(vnpAmountMinorUnits),
      vnp_CurrCode: 'VND',
      vnp_TxnRef: input.paymentId,
      vnp_OrderInfo: input.orderDescription,
      vnp_OrderType: 'other',
      vnp_Locale: 'en',
      vnp_ReturnUrl: gatewayEnv.returnUrl,
      vnp_IpAddr: clientIpPlaceholder,
      vnp_CreateDate: formatVnpCreateDateCompact(createdAt),
    };

    const sortedParams = sortVnpParameterKeysLexicographically(redirectQueryParams);
    const signablePayload = buildVnpSignablePayloadString(sortedParams);
    const secureHashHex = computeVnpHmacSha512Hex(gatewayEnv.hashSecret, signablePayload);
    return `${gatewayEnv.vnpUrl}?${signablePayload}&vnp_SecureHash=${secureHashHex}`;
  }

  verifySecureHash(query: VnpIpnQueryParams): { isValid: boolean; secureHash?: string } {
    const hashSecret = process.env.VNP_HASH_SECRET?.trim();
    if (!hashSecret) throw new BadRequestException('VNPAY is not configured');

    const receivedHash = query.vnp_SecureHash;
    if (!receivedHash) return { isValid: false };

    const paramsForSigning = collectVnpQueryFieldsForSignature(query);
    const sortedParams = sortVnpParameterKeysLexicographically(paramsForSigning);
    const signablePayload = buildVnpSignablePayloadString(sortedParams);
    const expectedHashHex = computeVnpHmacSha512Hex(hashSecret, signablePayload);
    return {
      isValid: expectedHashHex.toLowerCase() === receivedHash.toLowerCase(),
      secureHash: expectedHashHex,
    };
  }

  async verifyReturnQuery(query: VnpIpnQueryParams): Promise<{
    valid: boolean;
    txnRef?: string;
    responseCode?: string;
    transactionStatus?: string;
    orderId?: string | null;
    attemptStatus?: VnpPayAttempt['status'];
  }> {
    const { isValid } = this.verifySecureHash(query);
    const txnRef = query.vnp_TxnRef;
    const attempt = txnRef ? await getKeyJson<VnpPayAttempt>(this.vnpAttemptKey(txnRef)) : null;
    return {
      valid: isValid,
      txnRef,
      responseCode: query.vnp_ResponseCode,
      transactionStatus: query.vnp_TransactionStatus,
      orderId: attempt?.orderId ?? null,
      attemptStatus: attempt?.status,
    };
  }

  async handleIpn(query: VnpIpnQueryParams) {
    const { isValid } = this.verifySecureHash(query);
    if (!isValid) {
      return { RspCode: '97', Message: 'Invalid signature' };
    }

    const txnRef = query.vnp_TxnRef;
    const responseCode = query.vnp_ResponseCode;
    const transactionStatus = query.vnp_TransactionStatus;

    if (!txnRef) return { RspCode: '01', Message: 'Missing vnp_TxnRef' };

    const attemptKey = this.vnpAttemptKey(txnRef);
    const attempt = await getKeyJson<VnpPayAttempt>(attemptKey);
    if (!attempt) return { RspCode: '01', Message: 'Payment not found' };
    if (attempt.status === 'paid' && attempt.orderId) {
      return { RspCode: '00', Message: 'OK' };
    }

    const isPaidOk = responseCode === '00' && transactionStatus === '00';

    if (!isPaidOk) {
      await setKeyJson(
        attemptKey,
        { ...attempt, status: 'failed', ipn: query } satisfies VnpPayAttempt,
        this.attemptTtlSeconds(),
      );
      return { RspCode: '00', Message: 'OK' };
    }

    const orderId = await this.createOrderAfterVnpSuccess(attempt, query);
    await this.commissionSettlement.applyCommissionAndSettlement(orderId);
    await setKeyJson(
      attemptKey,
      { ...attempt, status: 'paid', orderId, ipn: query } satisfies VnpPayAttempt,
      this.attemptTtlSeconds(),
    );

    return { RspCode: '00', Message: 'OK' };
  }
}
