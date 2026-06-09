import { InlineKeyboard } from "grammy";
import { formatPrice } from "./format-price.js";

/**
 * Keyboard utilities for Telegram bot UI
 */

// ===========================================
// CLIENT BOT KEYBOARDS
// ===========================================

export const ClientKeyboards = {
  /** Main menu for verified users */
  mainMenu: () => {
    return new InlineKeyboard()
      .text("🛍️ محصولات", "client:products")
      .text("🛒 سبد خرید", "client:cart")
      .row()
      .text("📦 سفارش‌های من", "client:orders")
      .text("💬 پشتیبانی", "client:support")
      .row()
      .text("🔗 معرفی‌ها", "client:referrals")
      .text("👤 پروفایل", "client:profile")
      .row()
      .text("❓ راهنما", "client:help");
  },

  referralGate: () => {
    return new InlineKeyboard().text("💬 پشتیبانی", "client:support");
  },

  /** Back to main menu button */
  backToMenu: () => {
    return new InlineKeyboard()
      .text("« بازگشت به منو", "client:menu")
      .text("💬 پشتیبانی", "client:support");
  },

  /** Product list with add to cart buttons */
  productList: (products: { id: number; title: string; price: number }[], page: number = 0, totalPages: number = 1) => {
    const kb = new InlineKeyboard();
    
    products.forEach((p) => {
      kb.text(`${p.title} - ${formatPrice(p.price)}`, `client:product:${p.id}`).row();
    });

    // Pagination
    if (totalPages > 1) {
      if (page > 0) kb.text("« قبلی", `client:products:${page - 1}`);
      kb.text(`${page + 1}/${totalPages}`, "noop");
      if (page < totalPages - 1) kb.text("بعدی »", `client:products:${page + 1}`);
      kb.row();
    }

    kb.text("« بازگشت به منو", "client:menu").text("💬 پشتیبانی", "client:support");
    return kb;
  },

  /** Single product view with quantity controls */
  productView: (productId: number, currentQty: number = 1) => {
    return new InlineKeyboard()
      .text("−", `client:qty:dec:${productId}`)
      .text(`${currentQty}`, "noop")
      .text("+", `client:qty:inc:${productId}`)
      .row()
      .text("🛒 افزودن و ادامه خرید", `client:addtocart:${productId}:${currentQty}`)
      .row()
      .text("✅ افزودن و پرداخت", `client:addandcheckout:${productId}:${currentQty}`)
      .row()
      .text("« بازگشت به محصولات", "client:products")
      .row()
      .text("💬 پشتیبانی", "client:support");
  },

  /** Cart view with item controls */
  cartView: (items: { productId: number; title: string; qty: number }[]) => {
    const kb = new InlineKeyboard();

    items.forEach((item) => {
      kb.text(`${item.title} x${item.qty}`, `client:cartitem:${item.productId}`)
        .text("🗑️", `client:removefromcart:${item.productId}`)
        .row();
    });

    if (items.length > 0) {
      kb.text("« بازگشت به محصولات", "client:products")
        .text("✅ ثبت سفارش", "client:checkout")
        .row();
    }

    kb.text("« بازگشت به منو", "client:menu").text("💬 پشتیبانی", "client:support");
    return kb;
  },

  /** Referral menu */
  referralMenu: (codeCount: number, canCreate: boolean = false) => {
    const kb = new InlineKeyboard();
    
    if (canCreate && codeCount < 3) {
      kb.text("🔑 ساخت کد معرفی", "client:referral:generate").row();
    }
    
    kb.text("📊 آمار معرفی", "client:referral:stats").row();
    kb.text("« بازگشت به منو", "client:menu").text("💬 پشتیبانی", "client:support");
    return kb;
  },

  /** Confirm action */
  confirm: (action: string) => {
    return new InlineKeyboard()
      .text("✅ بله", `client:confirm:${action}`)
      .text("❌ خیر", "client:menu");
  },

  supportActions: (conversationId: number) => {
    return new InlineKeyboard()
      .text("✅ بستن گفتگو", `client:support:close:${conversationId}`)
      .row()
      .text("« بازگشت به منو", "client:menu");
  },
};

// ===========================================
// MANAGER BOT KEYBOARDS
// ===========================================

export const ManagerKeyboards = {
  /** Main menu for managers */
  mainMenu: () => {
    return new InlineKeyboard()
      .text("🧾 رسیدهای در انتظار", "mgr:receipts")
      .text("📊 همه سفارش‌ها", "mgr:allorders")
      .row()
      .text("📦 محصولات", "mgr:products")
      .row()
      .text("👥 کاربران", "mgr:users")
      .text("🔗 معرفی‌ها", "mgr:referrals")
      .row()
      .text("📊 آمار", "mgr:analytics")
      .text("💬 پشتیبانی", "mgr:support")
      .row()
      .text("🚚 پیک‌ها", "mgr:couriers")
      .text("⚙️ تنظیمات", "mgr:settings")
      .row()
      .text("❓ راهنما", "mgr:help");
  },

  /** Back to main menu */
  backToMenu: () => {
    return new InlineKeyboard().text("« بازگشت به منو", "mgr:menu");
  },

  /** Order list with approve/reject buttons */
  orderList: (orders: { id: number; userId: number; grandTotal: number }[], page: number = 0, totalPages: number = 1) => {
    const kb = new InlineKeyboard();

    orders.forEach((o) => {
      kb.text(`#${o.id} - ${formatPrice(o.grandTotal)}`, `mgr:order:${o.id}`)
        .text("✅", `mgr:approve:${o.id}`)
        .text("❌", `mgr:reject:${o.id}`)
        .row();
    });

    // Pagination
    if (totalPages > 1) {
      if (page > 0) kb.text("« قبلی", `mgr:orders:${page - 1}`);
      kb.text(`${page + 1}/${totalPages}`, "noop");
      if (page < totalPages - 1) kb.text("بعدی »", `mgr:orders:${page + 1}`);
      kb.row();
    }

    kb.text("« بازگشت به منو", "mgr:menu");
    return kb;
  },

  /** Product management menu */
  productManagement: () => {
    return new InlineKeyboard()
      .text("📋 لیست محصولات", "mgr:products:list")
      .row()
      .text("➕ افزودن محصول", "mgr:products:add")
      .row()
      .text("« بازگشت به منو", "mgr:menu");
  },

  /** Product list for management */
  productList: (products: { id: number; title: string; isActive: boolean }[], page: number = 0, totalPages: number = 1) => {
    const kb = new InlineKeyboard();

    products.forEach((p) => {
      const status = p.isActive ? "✅" : "❌";
      kb.text(`${status} ${p.title}`, `mgr:product:${p.id}`)
        .text("✏️", `mgr:product:edit:${p.id}`)
        .text("🗑️", `mgr:product:delete:${p.id}`)
        .row();
    });

    // Pagination
    if (totalPages > 1) {
      if (page > 0) kb.text("« قبلی", `mgr:products:list:${page - 1}`);
      kb.text(`${page + 1}/${totalPages}`, "noop");
      if (page < totalPages - 1) kb.text("بعدی »", `mgr:products:list:${page + 1}`);
      kb.row();
    }

    kb.text("➕ افزودن محصول", "mgr:products:add").row();
    kb.text("« بازگشت به منو", "mgr:menu");
    return kb;
  },

  /** Product edit menu */
  productEdit: (productId: number, hasImage: boolean = false) => {
    const kb = new InlineKeyboard()
      .text("📝 ویرایش عنوان", `mgr:product:edit:${productId}:title`)
      .row()
      .text("📄 ویرایش توضیحات", `mgr:product:edit:${productId}:desc`)
      .row()
      .text("💰 ویرایش قیمت", `mgr:product:edit:${productId}:price`)
      .row()
      .text("📦 ویرایش موجودی", `mgr:product:edit:${productId}:stock`)
      .row()
      .text("🖼️ ویرایش تصویر", `mgr:product:edit:${productId}:image`);
    
    if (hasImage) {
      kb.text("🗑️ حذف تصویر", `mgr:product:edit:${productId}:removeimage`);
    }
    
    kb.row()
      .text("🔄 تغییر وضعیت", `mgr:product:toggle:${productId}`)
      .row()
      .text("« بازگشت به محصولات", "mgr:products:list");
    
    return kb;
  },

  /** User management menu */
  userManagement: () => {
    return new InlineKeyboard()
      .text("📋 لیست کاربران", "mgr:users:list")
      .row()
      .text("🔍 جستجوی کاربر", "mgr:users:search")
      .row()
      .text("« بازگشت به منو", "mgr:menu");
  },

  /** User list */
  userList: (users: { id: number; username: string | null; isActive: boolean }[], page: number = 0, totalPages: number = 1) => {
    const kb = new InlineKeyboard();

    users.forEach((u) => {
      const status = u.isActive ? "✅" : "🚫";
      const name = u.username || `کاربر #${u.id}`;
      kb.text(`${status} ${name}`, `mgr:user:${u.id}`).row();
    });

    // Navigation
    if (totalPages > 1) {
      if (page > 0) kb.text("« قبلی", `mgr:users:list:${page - 1}`);
      kb.text(`${page + 1}/${totalPages}`, "noop");
      if (page < totalPages - 1) kb.text("بعدی »", `mgr:users:list:${page + 1}`);
      kb.row();
    }

    kb.text("« کاربران", "mgr:users").text("« منو", "mgr:menu");
    return kb;
  },

  /** User detail actions */
  userActions: (userId: number, isActive: boolean, canCreateReferral: boolean, discountPercent?: number | null) => {
    return new InlineKeyboard()
      .text("📦 سفارش‌ها", `mgr:user:orders:${userId}`)
      .text("📋 اطلاعات تماس", `mgr:user:contact:${userId}`)
      .row()
      .text("🔗 معرفی‌ها", `mgr:user:referrals:${userId}`)
      .text(
        canCreateReferral ? "🔒 لغو مجوز معرفی" : "🔑 مجوز معرفی",
        `mgr:user:toggleref:${userId}`
      )
      .row()
      .text("⭐ تغییر امتیاز", `mgr:user:setscore:${userId}`)
      .text(
        isActive ? "🚫 مسدود کردن" : "✅ رفع مسدودیت",
        `mgr:user:toggle:${userId}`
      )
      .row()
      .text(discountPercent ? `🎯 تخفیف ${discountPercent}%` : "🎯 تنظیم تخفیف", `mgr:user:setdiscount:${userId}`)
      .text("🗑️ حذف کاربر", `mgr:user:delete:${userId}`)
      .row()
      .text("💬 ارسال پیام", `mgr:user:message:${userId}`)
      .row()
      .text("« کاربران", "mgr:users:list")
      .text("« منو", "mgr:menu");
  },

  /** Referral management menu */
  referralManagement: () => {
    return new InlineKeyboard()
      .text("📋 لیست کدها", "mgr:referrals:list")
      .row()
      .text("➕ ساخت کد", "mgr:referrals:create")
      .row()
      .text("📊 آمار", "mgr:referrals:stats")
      .row()
      .text("« بازگشت به منو", "mgr:menu");
  },

  /** Analytics menu */
  analyticsMenu: () => {
    return new InlineKeyboard()
      .text("📦 آمار سفارش‌ها", "mgr:analytics:orders")
      .text("👥 آمار کاربران", "mgr:analytics:users")
      .row()
      .text("📦 آمار محصولات", "mgr:analytics:products")
      .text("🔗 آمار معرفی", "mgr:analytics:referrals")
      .row()
      .text("« بازگشت به منو", "mgr:menu");
  },

  /** Settings menu */
  settingsMenu: (hasImage: boolean) => {
    const kb = new InlineKeyboard()
      .text("🏦 شماره کارت", "mgr:settings:card")
      .row()
      .text("🚚 پیام ارسال", "mgr:settings:deliverymsg")
      .row()
      .text("🖼️ تغییر تصویر پرداخت", "mgr:settings:image")
      .row()
      .text("⏳ تغییر مهلت پرداخت", "mgr:settings:expiry")
      .row();
    if (hasImage) {
      kb.text("🗑️ حذف تصویر پرداخت", "mgr:settings:image:delete").row();
    }
    kb.text("« بازگشت به منو", "mgr:menu");
    return kb;
  },

  /** Courier management menu */
  courierManagement: () => {
    return new InlineKeyboard()
      .text("📋 لیست پیک‌ها", "mgr:couriers:list")
      .row()
      .text("➕ افزودن پیک", "mgr:couriers:add")
      .row()
      .text("« بازگشت به منو", "mgr:menu");
  },

  /** Courier list */
  courierList: (couriers: { id: number; username: string | null; tgUserId: bigint; isActive: boolean }[]) => {
    const kb = new InlineKeyboard();
    couriers.forEach((c) => {
      const status = c.isActive ? "✅" : "🚫";
      const name = c.username || `پیک #${c.id}`;
      kb.text(`${status} ${name}`, `mgr:courier:${c.id}`).row();
    });
    kb.text("➕ افزودن پیک", "mgr:couriers:add").row();
    kb.text("« بازگشت به منو", "mgr:menu");
    return kb;
  },

  /** Courier detail actions */
  courierActions: (courierId: number, isActive: boolean) => {
    return new InlineKeyboard()
      .text(
        isActive ? "🚫 غیرفعال" : "✅ فعال",
        `mgr:courier:toggle:${courierId}`
      )
      .text("🗑️ حذف", `mgr:courier:delete:${courierId}`)
      .row()
      .text("« بازگشت به لیست پیک‌ها", "mgr:couriers:list");
  },

  /** Confirm dangerous action */
  confirm: (action: string, entityId: number) => {
    return new InlineKeyboard()
      .text("✅ تأیید", `mgr:confirm:${action}:${entityId}`)
      .text("❌ لغو", "mgr:menu");
  },

  /** Receipt list for management — 2 receipts per row */
  receiptList: (receipts: { id: number; orderId: number; user: { id: number; username: string | null } }[], page: number = 0, totalPages: number = 1) => {
    const kb = new InlineKeyboard();

    receipts.forEach((r, i) => {
      const name = r.user.username || `کاربر ${r.user.id}`;
      kb.text(`👤 ${name}`, `mgr:receipt:view:${r.id}`);
      if (i % 2 === 1) kb.row();
    });
    if (receipts.length % 2 !== 0) kb.row();

    // Pagination
    if (totalPages > 1) {
      if (page > 0) kb.text("« قبلی", `mgr:receipts:page:${page - 1}`);
      kb.text(`${page + 1}/${totalPages}`, "noop");
      if (page < totalPages - 1) kb.text("بعدی »", `mgr:receipts:page:${page + 1}`);
      kb.row();
    }

    kb.text("« بازگشت به منو", "mgr:menu");
    return kb;
  },

  /** Receipt actions (approve/reject/view order) */
  receiptActions: (receiptId: number, orderId: number) => {
    return new InlineKeyboard()
      .text("✅ تأیید رسید", `mgr:receipt:approve:${receiptId}`)
      .text("❌ رد رسید", `mgr:receipt:reject:${receiptId}`)
      .row()
      .text("📋 مشاهده سفارش", `mgr:order:${orderId}`)
      .row()
      .text("« بازگشت به رسیدها", "mgr:receipts");
  },

  supportInbox: (conversations: { id: number; userLabel: string; lastMessageAtLabel: string }[], page: number = 0, totalPages: number = 1) => {
    const kb = new InlineKeyboard();

    conversations.forEach((c) => {
      kb.text(`${c.userLabel} · ${c.lastMessageAtLabel}`, `mgr:support:conv:${c.id}`).row();
    });

    if (totalPages > 1) {
      if (page > 0) kb.text("« قبلی", `mgr:support:${page - 1}`);
      kb.text(`${page + 1}/${totalPages}`, "noop");
      if (page < totalPages - 1) kb.text("بعدی »", `mgr:support:${page + 1}`);
      kb.row();
    }

    kb.text("« بازگشت به منو", "mgr:menu");
    return kb;
  },

  supportConversationActions: (conversationId: number) => {
    return new InlineKeyboard()
      .text("✍️ پاسخ", `mgr:support:reply:${conversationId}`)
      .text("✅ بستن", `mgr:support:close:${conversationId}`)
      .row()
      .text("« بازگشت به صندوق", "mgr:support");
  },

  /** Inline actions for receipt notification — approve/reject directly */
  receiptNotificationActions: (receiptId: number, orderId: number) => {
    return new InlineKeyboard()
      .text("✅ تأیید رسید", `mgr:receipt:approve:${receiptId}`)
      .text("❌ رد رسید", `mgr:receipt:reject:${receiptId}`)
      .row()
      .text("📋 مشاهده سفارش", `mgr:order:${orderId}`);
  },

  /** Inline action for support message notification — view conversation */
  supportNotificationActions: (conversationId: number) => {
    return new InlineKeyboard()
      .text("💬 مشاهده گفتگو", `mgr:support:conv:${conversationId}`);
  },

  /** Inline action for delivery failure notification — view order */
  deliveryFailedNotificationActions: (orderId: number) => {
    return new InlineKeyboard()
      .text("📋 مشاهده سفارش", `mgr:order:${orderId}`);
  },
};

export const CourierKeyboards = {
  menu: () => {
    return new InlineKeyboard()
      .text("🚚 ارسال‌های فعال", "courier:deliveries")
      .row()
      .text("📋 تاریخچه", "courier:history")
      .row()
      .text("🔄 بروزرسانی", "courier:menu");
  },
  backToMenu: () => {
    return new InlineKeyboard().text("« بازگشت", "courier:menu");
  },
  deliveriesList: (deliveries: { id: number; orderId: number; statusLabel: string }[]) => {
    const kb = new InlineKeyboard();
    for (const d of deliveries) {
      kb.text(`#${d.orderId} · ${d.statusLabel}`, `courier:delivery:${d.id}`).row();
    }
    kb.text("« بازگشت", "courier:menu");
    return kb;
  },
  deliveryActions: (deliveryId: number, currentStatus?: string) => {
    const kb = new InlineKeyboard();

    // Show only the logical next status transitions
    if (!currentStatus || currentStatus === "ASSIGNED") {
      kb.text("📦 تحویل گرفتم", `courier:status:${deliveryId}:PICKED_UP`).row();
    }
    if (!currentStatus || currentStatus === "ASSIGNED" || currentStatus === "PICKED_UP") {
      kb.text("🛵 در مسیر ارسال", `courier:status:${deliveryId}:OUT_FOR_DELIVERY`).row();
    }
    if (!currentStatus || (currentStatus !== "DELIVERED" && currentStatus !== "FAILED")) {
      kb.text("✅ تحویل دادم", `courier:status:${deliveryId}:DELIVERED`).row();
      kb.text("❌ ناموفق", `courier:status:${deliveryId}:FAILED`).row();
    }

    // Location button
    kb.text("📍 مشاهده موقعیت", `courier:location:${deliveryId}`).row();

    kb.text("« بازگشت", "courier:deliveries");
    return kb;
  },
  backToDelivery: (deliveryId: number) => {
    return new InlineKeyboard().text("« بازگشت", `courier:delivery:${deliveryId}`);
  },
  backToDeliveries: () => {
    return new InlineKeyboard().text("« بازگشت", "courier:deliveries");
  },
};
