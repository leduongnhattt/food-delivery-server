import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { OrdersRepository, OrderListCriteria } from '@infra/repositories/orders.repository';
import { CustomersService } from '@modules/customers/customers.service';
import { PAYMENT_METHOD } from '@common/constants/payment-method.constants';

export interface OrderItemDto {
  id: string;
  orderId: string;
  foodId: string;
  foodName: string;
  quantity: number;
  price: number;
  specialInstructions?: string;
}

export interface OrderDto {
  id: string;
  customerId: string;
  restaurantId: string;
  restaurantName: string;
  items: OrderItemDto[];
  totalAmount: number;
  status: string;
  deliveryAddress: string;
  deliveryInstructions?: string;
  paymentMethod: string;
  createdAt: string;
  updatedAt: string;
  estimatedDeliveryTime?: string;
}

export interface OrdersListResponse {
  orders: OrderDto[];
  total: number;
  page: number;
  limit: number;
}

export interface OrderCartMenuItemDto {
  id: string;
  price: number;
}

export interface OrderCartItemDto {
  menuItem: OrderCartMenuItemDto;
  quantity: number;
}

export interface DeliveryInfoDto {
  address: string;
}

export interface CreateOrderRequestDto {
  cartItems: OrderCartItemDto[];
  deliveryInfo: DeliveryInfoDto;
  voucherCode?: string;
  paymentIntentId?: string;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly repo: OrdersRepository,
    private readonly customersService: CustomersService,
  ) {}

  async listForCustomer(accountId: string, params: {
    status?: string;
    page?: number;
    limit?: number;
    startDate?: string;
    endDate?: string;
  }): Promise<OrdersListResponse> {
    const customer = await this.customersService.getByAccountId(accountId);
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    const criteria: OrderListCriteria = {
      customerId: customer.CustomerID,
      status: params.status,
      page: params.page,
      limit: params.limit,
      startDate: params.startDate ? new Date(params.startDate) : undefined,
      endDate: params.endDate ? new Date(params.endDate) : undefined,
    };

    const { rows, total, page, limit } = await this.repo.findManyForCustomer(criteria);

    const orders = rows.map((order) => {
      const firstDetail = order.orderDetails[0];
      const restaurantName = firstDetail?.food?.enterprise?.EnterpriseName ?? 'Unknown Restaurant';
      const restaurantId = firstDetail?.food?.EnterpriseID ?? '';

      const items: OrderItemDto[] = order.orderDetails.map((detail) => ({
        id: detail.OrderDetailID,
        orderId: detail.OrderID,
        foodId: detail.FoodID,
        foodName: detail.food.DishName,
        quantity: detail.Quantity,
        price: Number(detail.SubTotal),
        specialInstructions: undefined,
      }));

      return {
        id: order.OrderID,
        customerId: order.CustomerID,
        restaurantId,
        restaurantName,
        items,
        totalAmount: Number(order.TotalAmount),
        status: String(order.Status).toLowerCase(),
        deliveryAddress: order.DeliveryAddress,
        deliveryInstructions: order.DeliveryNote ?? undefined,
        paymentMethod: 'card',
        createdAt: order.OrderDate.toISOString(),
        updatedAt: order.OrderDate.toISOString(),
        estimatedDeliveryTime: order.EstimatedDeliveryTime?.toISOString(),
      };
    });

    return { orders, total, page, limit };
  }

  async getByIdForCustomer(accountId: string, orderId: string): Promise<OrderDto> {
    const customer = await this.customersService.getByAccountId(accountId);
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    const order = await this.repo.findById(orderId);
    if (!order || order.CustomerID !== customer.CustomerID) {
      throw new NotFoundException('Order not found');
    }

    const firstDetail = order.orderDetails[0];
    const restaurantId = firstDetail?.food.enterprise.EnterpriseID || '';
    const restaurantName = firstDetail?.food.enterprise.EnterpriseName || '';
    const items: OrderItemDto[] = order.orderDetails.map((od) => ({
      id: od.OrderDetailID,
      orderId: od.OrderID,
      foodId: od.FoodID,
      foodName: od.food.DishName,
      quantity: od.Quantity,
      price: Number(od.food.Price),
      specialInstructions: od.food.Description || undefined,
    }));

    return {
      id: order.OrderID,
      customerId: order.CustomerID,
      restaurantId,
      restaurantName,
      items,
      totalAmount: Number(order.TotalAmount),
      status: String(order.Status).toLowerCase(),
      deliveryAddress: order.DeliveryAddress,
      deliveryInstructions: order.DeliveryNote || undefined,
      paymentMethod: order.payments[0]?.PaymentMethod || PAYMENT_METHOD.CreditCard,
      createdAt: order.OrderDate.toISOString(),
      updatedAt: new Date().toISOString(),
      estimatedDeliveryTime: order.EstimatedDeliveryTime?.toISOString(),
    };
  }

  async cancelForCustomer(accountId: string, orderId: string): Promise<{ success: true }> {
    const customer = await this.customersService.getByAccountId(accountId);
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    const order = await this.repo.findForOwnershipCheck(orderId);
    if (!order || order.CustomerID !== customer.CustomerID) {
      throw new NotFoundException('Order not found');
    }

    if ((order.Status || '').toLowerCase() !== 'pending') {
      throw new BadRequestException('Only pending orders can be cancelled');
    }

    await this.repo.deleteOrderCascade(orderId);
    return { success: true };
  }

  async trackForCustomer(accountId: string, orderId: string): Promise<{
    status: string;
    estimatedDeliveryTime?: string | null;
    trackingInfo?: {
      currentLocation?: string;
      driverName?: string;
      driverPhone?: string;
    };
    orderTime: string;
    lastUpdated?: string | null;
  }> {
    const customer = await this.customersService.getByAccountId(accountId);
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    const order = await this.repo.findById(orderId);
    if (!order || order.CustomerID !== customer.CustomerID) {
      throw new NotFoundException('Order not found');
    }

    const orderTime = order.OrderDate;
    let estimatedDeliveryTime: Date | null = null;
    const status = String(order.Status);

    if (status === 'Pending') {
      estimatedDeliveryTime = new Date(orderTime.getTime() + 45 * 60000);
    } else if (status === 'Completed') {
      estimatedDeliveryTime = order.EstimatedDeliveryTime ?? null;
    } else if (status === 'Cancelled') {
      estimatedDeliveryTime = null;
    }

    return {
      status,
      estimatedDeliveryTime: estimatedDeliveryTime?.toISOString() ?? null,
      trackingInfo: {},
      orderTime: orderTime.toISOString(),
      lastUpdated: order.EstimatedDeliveryTime?.toISOString() ?? null,
    };
  }

  async reorderForCustomer(accountId: string, orderId: string): Promise<{ success: boolean; message: string }> {
    const customer = await this.customersService.getByAccountId(accountId);
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    const order = await this.repo.findById(orderId);
    if (!order || order.CustomerID !== customer.CustomerID) {
      throw new NotFoundException('Order not found');
    }

    const status = String(order.Status).toLowerCase();
    if (status === 'cancelled') {
      throw new BadRequestException('Cannot reorder a cancelled order');
    }

    await this.repo.createReorderFromExisting({
      OrderID: order.OrderID,
      CustomerID: order.CustomerID,
      VoucherID: order.VoucherID ?? null,
      TotalAmount: order.TotalAmount,
      DeliveryAddress: order.DeliveryAddress,
      DeliveryNote: order.DeliveryNote ?? null,
      orderDetails: order.orderDetails.map((od) => ({
        OrderDetailID: od.OrderDetailID,
        OrderID: od.OrderID,
        FoodID: od.FoodID,
        SubTotal: od.SubTotal,
        Quantity: od.Quantity,
      })),
    });

    return {
      success: true,
      message: 'Order has been re-created from previous order items.',
    };
  }

  async createForCustomer(
    accountId: string,
    body: CreateOrderRequestDto,
  ): Promise<{ orderId: string; total: number }> {
    const customer = await this.customersService.getByAccountId(accountId);
    if (!customer) {
      throw new NotFoundException('Customer profile not found. Please login to place an order.');
    }

    const { cartItems, deliveryInfo, voucherCode, paymentIntentId } = body ?? {};
    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      throw new BadRequestException('Cart is empty');
    }

    await this.repo.validateFoodsAvailability(cartItems);

    const subtotal = cartItems.reduce(
      (sum: number, item: OrderCartItemDto) => sum + item.menuItem.price * item.quantity,
      0,
    );
    const deliveryFee = 0.5;
    const voucherDiscount = 0;
    const total = subtotal + deliveryFee - voucherDiscount;

    let voucherId: string | null = null;
    if (voucherCode) {
      voucherId = await this.repo.findValidVoucherId(voucherCode);
    }

    const { order } = await this.repo.createOrderWithDetailsAndPayment({
      customerId: customer.CustomerID,
      cartItems,
      deliveryAddress: deliveryInfo.address,
      voucherId,
      totalAmount: total,
      paymentIntentId,
    });

    // TODO: clear cart after order creation if needed

    return {
      orderId: order.OrderID,
      total,
    };
  }
}

