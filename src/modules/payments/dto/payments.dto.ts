/**
 * DTOs and shared types for the payments module.
 */

export interface CreateCheckoutSessionCartItemDto {
    menuItem: {
        id: string;
        name: string;
        price: number;
        image?: string | null;
        restaurantId: string;
        restaurantName?: string | null;
    };
    quantity: number;
}

export interface CreateCheckoutSessionRequestDto {
    cartItems: CreateCheckoutSessionCartItemDto[];
    deliveryInfo: {
        phone: string;
        address: string;
    };
    voucherCode?: string;
    total: number;
    /** Optional; if omitted, server uses APP_URL to build redirect URLs */
    successUrl?: string;
    cancelUrl?: string;
    currency?: string; // default 'usd'
}

export interface StoreCartDataRequestDto {
    sessionId: string;
    cartItems: unknown[];
    deliveryInfo?: { phone?: string; address?: string };
    voucherCode?: string;
    total?: number;
}
