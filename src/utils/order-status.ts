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
      return status;
  }
}
