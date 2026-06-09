import { OrderStatus } from "@prisma/client";

/**
 * Map OrderStatus enum values to Persian labels for user-facing display.
 */
export function orderStatusLabel(status: OrderStatus): string {
  switch (status) {
    case OrderStatus.AWAITING_MANAGER_APPROVAL:
      return "⏳ در انتظار تأیید مدیر";
    case OrderStatus.APPROVED:
      return "✅ تأیید شده";
    case OrderStatus.INVITE_SENT:
      return "📨 لینک پرداخت ارسال شده";
    case OrderStatus.AWAITING_RECEIPT:
      return "🧾 در انتظار رسید";
    case OrderStatus.PAID:
      return "💰 پرداخت شده";
    case OrderStatus.COMPLETED:
      return "✅ تکمیل شده";
    case OrderStatus.CANCELLED:
      return "❌ لغو شده";
    default:
      console.warn(`[orderStatusLabel] Unknown OrderStatus: ${status}`);
      return status;
  }
}

/**
 * Map event type strings to Persian labels for display in order history.
 */
export function eventTypeLabel(eventType: string): string {
  const labels: Record<string, string> = {
    order_approved: "✅ تأیید سفارش توسط مدیر",
    order_rejected: "❌ رد سفارش توسط مدیر",
    order_cancelled: "❌ لغو سفارش توسط مدیر",
    order_deleted: "🗑️ حذف سفارش توسط مدیر",
    receipt_approved: "✅ تأیید رسید توسط مدیر",
    receipt_rejected: "❌ رد رسید توسط مدیر",
    payment_details_sent_direct: "💳 ارسال اطلاعات پرداخت",
  };
  return labels[eventType] || eventType;
}

/**
 * Map ReceiptReviewStatus to Persian labels.
 */
export function receiptStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    PENDING: "⏳ در انتظار بررسی",
    ACCEPTED: "✅ تأیید شده",
    REJECTED: "❌ رد شده",
  };
  return labels[status] || status;
}

/**
 * Map DeliveryStatus to Persian labels.
 */
export function deliveryStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    ASSIGNED: "📋 تعیین پیک",
    PICKED_UP: "📦 تحویل گرفته شد",
    OUT_FOR_DELIVERY: "🛵 در مسیر ارسال",
    DELIVERED: "✅ تحویل داده شد",
    FAILED: "❌ ناموفق",
  };
  return labels[status] || status;
}
