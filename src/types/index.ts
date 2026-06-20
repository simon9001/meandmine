import type { SupabaseClient } from '@supabase/supabase-js';

export type UserRole = 'customer' | 'admin' | 'superadmin' | 'supplier_rep';

export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'refunded'
  | 'disputed';

export type PaymentStatus =
  | 'pending'
  | 'initiated'
  | 'paid'
  | 'failed'
  | 'refunded'
  | 'partially_refunded';

export type PaymentProvider = 'paystack' | 'mpesa' | 'bank_transfer' | 'cash_on_delivery';

export type PaymentCurrency = 'KES' | 'NGN' | 'USD' | 'GBP';

export type ProductStatus = 'draft' | 'active' | 'archived' | 'out_of_stock';

export type SupplyStatus = 'active' | 'discontinued' | 'out_of_stock' | 'on_hold';

export type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'flagged';

export type ShipmentStatus =
  | 'pending'
  | 'ready_to_ship'
  | 'dispatched'
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivered'
  | 'returned'
  | 'failed';

export type DiscountType = 'percentage' | 'fixed_amount' | 'free_shipping' | 'buy_x_get_y';

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
}

export type AppVariables = {
  user?: AuthUser;
  userClient?: SupabaseClient;
  requestId: string;
};

export type AppEnv = { Variables: AppVariables };

export interface PaginatedResult<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface CheckoutItem {
  productId: string;
  variantId?: string;
  supplyId?: string;
  quantity: number;
}

export interface CheckoutPayload {
  items: CheckoutItem[];
  addressId?: string;
  shippingAddress?: Record<string, string>;
  discountCode?: string;
  shippingFee?: number;
  notes?: string;
  idempotencyKey?: string;
}
