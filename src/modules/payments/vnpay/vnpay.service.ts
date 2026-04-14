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
import {
  loadAccountCurrencyCode,
  loadEnterpriseDisplayNameFromFirstCartItem,
} from '@modules/payments/vnpay/utils/vnpay-payment-context.lookup';
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

@Injectable()
export class VnPayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usdVndExchangeRate: UsdVndExchangeRateService,
    private readonly etaService: EtaService,
  ) { }

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
    const { orderId, paymentId } = await this.persistPendingVnpOrderAndPayment({
      accountId,
      customerId,
      dto,
      accountCurrency,
      amountVnd,
      exchangeRateVndPerUsd,
      fxQuoteHost,
      enterpriseDisplayName,
    });

    const enterpriseId = dto.cartItems?.[0]?.menuItem?.restaurantId;
    if (enterpriseId) {
      await this.etaService.computeAndPersistForOrder({
        orderId,
        enterpriseId,
        deliveryInfo: {
          address: dto.deliveryInfo.address,
          lat: dto.deliveryInfo.lat,
          lng: dto.deliveryInfo.lng,
        },
      }).catch(() => undefined);
    }

    const paymentRedirectUrl = this.buildSignedVnpPaymentRedirectUrl(gatewayEnv, {
      orderId,
      paymentId,
      amountVnd,
      orderDescription: sanitizeVnpOrderDescription(
        `Payment at ${enterpriseDisplayName} — Order ${orderId}`,
      ),
    });

    return { url: paymentRedirectUrl, orderId, paymentId };
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

  private async persistPendingVnpOrderAndPayment(params: {
    accountId: string;
    customerId: string;
    dto: CreateCheckoutSessionRequestDto;
    accountCurrency: string;
    amountVnd: number;
    exchangeRateVndPerUsd: number;
    fxQuoteHost: string;
    enterpriseDisplayName: string;
  }): Promise<{ orderId: string; paymentId: string }> {
    const paymentId = crypto.randomUUID();
    const {
      dto,
      accountId,
      customerId,
      accountCurrency,
      amountVnd,
      exchangeRateVndPerUsd,
      fxQuoteHost,
      enterpriseDisplayName,
    } = params;

    const created = await this.prisma.$transaction(async (tx) => {
      return tx.order.create({
        data: {
          CustomerID: customerId,
          VoucherID: null,
          TotalAmount: dto.total,
          DeliveryAddress: dto.deliveryInfo.address,
          DeliveryNote: '',
          Status: ORDER_STATUS.Pending,
          Metadata: {
            provider: PAYMENT_PROVIDER.VnPay,
            accountId,
            voucherCode: dto.voucherCode || null,
            phone: dto.deliveryInfo.phone || null,
            currency: accountCurrency,
            vnpay: {
              enterpriseName: enterpriseDisplayName,
              amountVnd,
              usdToVndRate: exchangeRateVndPerUsd,
              fxQuoteHost,
            },
          },
          orderDetails: {
            create: dto.cartItems.map((item) => ({
              FoodID: item.menuItem.id,
              SubTotal: item.menuItem.price * item.quantity,
              Quantity: item.quantity,
            })),
          },
          payments: {
            create: {
              PaymentID: paymentId,
              PaymentStatus: PAYMENT_STATUS.Pending,
              PaymentMethod: PAYMENT_METHOD.VNPay,
              TransactionID: paymentId,
              TransactionData: {
                provider: PAYMENT_PROVIDER.VnPay,
                createdAt: new Date().toISOString(),
                enterpriseName: enterpriseDisplayName,
                currency: accountCurrency,
                amountVnd,
                usdToVndRate: exchangeRateVndPerUsd,
                fxQuoteHost,
              },
            },
          },
        },
        select: { OrderID: true },
      });
    });

    return { orderId: created.OrderID, paymentId };
  }

  private buildSignedVnpPaymentRedirectUrl(
    gatewayEnv: VnpPayGatewayEnvConfig,
    input: {
      orderId: string;
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

  verifyReturnQuery(query: VnpIpnQueryParams): {
    valid: boolean;
    txnRef?: string;
    responseCode?: string;
    transactionStatus?: string;
  } {
    const { isValid } = this.verifySecureHash(query);
    return {
      valid: isValid,
      txnRef: query.vnp_TxnRef,
      responseCode: query.vnp_ResponseCode,
      transactionStatus: query.vnp_TransactionStatus,
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

    const payment = await this.prisma.payment.findUnique({
      where: { TransactionID: txnRef },
      select: {
        PaymentID: true,
        OrderID: true,
        PaymentStatus: true,
        TransactionData: true,
      },
    });
    if (!payment) return { RspCode: '01', Message: 'Payment not found' };

    if (
      payment.PaymentStatus === PAYMENT_STATUS.Completed ||
      payment.PaymentStatus === PAYMENT_STATUS.Failed
    ) {
      return { RspCode: '00', Message: 'OK' };
    }

    const isPaidOk = responseCode === '00' && transactionStatus === '00';

    const priorTx =
      payment.TransactionData &&
      typeof payment.TransactionData === 'object' &&
      !Array.isArray(payment.TransactionData)
        ? (payment.TransactionData as Record<string, unknown>)
        : {};

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { PaymentID: payment.PaymentID },
        data: {
          PaymentStatus: isPaidOk ? PAYMENT_STATUS.Completed : PAYMENT_STATUS.Failed,
          TransactionData: {
            ...priorTx,
            provider: PAYMENT_PROVIDER.VnPay,
            ipn: query,
            updatedAt: new Date().toISOString(),
          },
        },
      });
      await tx.order.update({
        where: { OrderID: payment.OrderID },
        data: { Status: isPaidOk ? ORDER_STATUS.Confirmed : ORDER_STATUS.Cancelled },
      });
    });

    return { RspCode: '00', Message: 'OK' };
  }
}
