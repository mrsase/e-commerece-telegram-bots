import { OrderStatus } from "@prisma/client";

/**
 * Map OrderStatus enum values to Persian labels for user-facing display.
 */
export function orderStatusLabel(status: OrderStatus): string {
  switch (status) {
    case OrderStatus.AWAITING_MANAGER_APPROVAL:
      return "⏳ در انتظار تأیید مدیر";
    case OrderStatus.APPROVED:
      return "✅ تأییدشده";
    case OrderStatus.INVITE_SENT:
      return "💳 اطلاعات پرداخت ارسال‌شده";
    case OrderStatus.AWAITING_RECEIPT:
      return "🧾 در انتظار رسید";
    case OrderStatus.PAID:
      return "💰 پرداخت‌شده";
    case OrderStatus.COMPLETED:
      return "✅ تکمیل‌شده";
    case OrderStatus.CANCELLED:
      return "❌ لغوشده";
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
    ACCEPTED: "✅ تأییدشده",
    REJECTED: "❌ ردشده",
  };
  return labels[status] || status;
}

/**
 * Map DeliveryStatus to Persian labels.
 */
export function deliveryStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    ASSIGNED: "📋 اختصاص داده‌شده به پیک",
    PICKED_UP: "📦 بسته تحویل پیک شد",
    OUT_FOR_DELIVERY: "🛵 در مسیر ارسال",
    DELIVERED: "✅ تحویل داده شد",
    FAILED: "❌ تحویل ناموفق",
  };
  return labels[status] || status;
}
