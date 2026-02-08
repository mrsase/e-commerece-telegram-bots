import { InlineKeyboard } from "grammy";

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
      kb.text(`${p.title} - ${p.price}`, `client:product:${p.id}`).row();
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
      .text("➖", `client:qty:dec:${productId}`)
      .text(`${currentQty}`, "noop")
      .text("➕", `client:qty:inc:${productId}`)
      .row()
      .text("🛒 افزودن به سبد", `client:addtocart:${productId}:${currentQty}`)
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
      kb.text("🗑️ خالی کردن سبد", "client:clearcart")
        .text("✅ ثبت سفارش", "client:checkout")
        .row();
    }

    kb.text("« بازگشت به منو", "client:menu").text("💬 پشتیبانی", "client:support");
    return kb;
  },

  /** Referral menu */
  referralMenu: (hasCode: boolean) => {
    const kb = new InlineKeyboard();
    
    if (!hasCode) {
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
      .text("📋 سفارش‌ها", "mgr:orders")
      .text("🧾 رسیدها", "mgr:receipts")
      .row()
      .text("📦 محصولات", "mgr:products")
      .text("👥 کاربران", "mgr:users")
      .row()
      .text("🔗 معرفی‌ها", "mgr:referrals")
      .text("📊 آمار", "mgr:analytics")
      .row()
      .text("💬 پشتیبانی", "mgr:support")
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
      kb.text(`#${o.id} - ${o.grandTotal}`, `mgr:order:${o.id}`)
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

    // Pagination
    if (totalPages > 1) {
      if (page > 0) kb.text("« قبلی", `mgr:users:list:${page - 1}`);
      kb.text(`${page + 1}/${totalPages}`, "noop");
      if (page < totalPages - 1) kb.text("بعدی »", `mgr:users:list:${page + 1}`);
      kb.row();
    }

    kb.text("« بازگشت به منو", "mgr:menu");
    return kb;
  },

  /** User detail actions */
  userActions: (userId: number, isActive: boolean) => {
    return new InlineKeyboard()
      .text("📦 سفارش‌ها", `mgr:user:orders:${userId}`)
      .row()
      .text("🔗 معرفی‌ها", `mgr:user:referrals:${userId}`)
      .row()
      .text(
        isActive ? "🚫 مسدود کردن" : "✅ رفع مسدودیت",
        `mgr:user:toggle:${userId}`
      )
      .row()
      .text("« بازگشت به کاربران", "mgr:users:list");
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
      .row()
      .text("👥 آمار کاربران", "mgr:analytics:users")
      .row()
      .text("📦 آمار محصولات", "mgr:analytics:products")
      .row()
      .text("🔗 آمار معرفی", "mgr:analytics:referrals")
      .row()
      .text("« بازگشت به منو", "mgr:menu");
  },

  /** Confirm dangerous action */
  confirm: (action: string, entityId: number) => {
    return new InlineKeyboard()
      .text("✅ تأیید", `mgr:confirm:${action}:${entityId}`)
      .text("❌ لغو", "mgr:menu");
  },

  /** Receipt list for management */
  receiptList: (receipts: { id: number; orderId: number; user: { username: string | null } }[], page: number = 0, totalPages: number = 1) => {
    const kb = new InlineKeyboard();

    receipts.forEach((r) => {
      const name = r.user.username || `کاربر`;
      kb.text(`🧾 سفارش #${r.orderId} - ${name}`, `mgr:receipt:view:${r.id}`).row();
    });

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

  /** Receipt actions (approve/reject) */
  receiptActions: (receiptId: number) => {
    return new InlineKeyboard()
      .text("✅ تأیید", `mgr:receipt:approve:${receiptId}`)
      .text("❌ رد", `mgr:receipt:reject:${receiptId}`)
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
};

export const CourierKeyboards = {
  menu: () => {
    return new InlineKeyboard()
      .text("🚚 ارسال‌های من", "courier:deliveries")
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
  deliveryActions: (deliveryId: number) => {
    return new InlineKeyboard()
      .text("📦 تحویل گرفتم", `courier:delivery:set:${deliveryId}:PICKED_UP`)
      .row()
      .text("🛵 در مسیر ارسال", `courier:delivery:set:${deliveryId}:OUT_FOR_DELIVERY`)
      .row()
      .text("✅ تحویل شد", `courier:delivery:set:${deliveryId}:DELIVERED`)
      .text("❌ ناموفق", `courier:delivery:set:${deliveryId}:FAILED`)
      .row()
      .text("« بازگشت", "courier:deliveries");
  },
  backToDelivery: (deliveryId: number) => {
    return new InlineKeyboard().text("« بازگشت", `courier:delivery:${deliveryId}`);
  },
  backToDeliveries: () => {
    return new InlineKeyboard().text("« بازگشت", "courier:deliveries");
  },
};
