import { InlineKeyboard } from "grammy";
import { formatPrice } from "./format-price.js";
import { normalizeIranianPhone } from "./phone.js";

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
      .text("🛍️ شروع خرید", "client:products")
      .text("🧺 سبد خرید", "client:cart")
      .row()
      .text("📦 سفارش‌ها", "client:orders")
      .text("💬 پشتیبانی", "client:support")
      .row()
      .text("👤 حساب من", "client:profile")
      .text("🎟️ دعوت‌نامه‌ها", "client:referrals")
      .row()
      .text("📣 اطلاعیه‌ها", "client:announcements")
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
      .text("🧺 افزودن به سبد", `client:addtocart:${productId}:${currentQty}`)
      .row()
      .text("✅ خرید همین محصول", `client:addandcheckout:${productId}:${currentQty}`)
      .row()
      .text("« بازگشت به محصولات", "client:products")
      .row()
      .text("💬 پشتیبانی", "client:support");
  },

  productUnavailable: () => {
    return new InlineKeyboard()
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
      kb.text("✅ ثبت سفارش", "client:checkout")
        .text("➕ افزودن محصول", "client:products")
        .row();
    }

    kb.text("« بازگشت به منو", "client:menu").text("💬 پشتیبانی", "client:support");
    return kb;
  },

  /** Referral menu */
  referralMenu: (codeCount: number, canCreate: boolean = false, maxCodes: number = 3) => {
    const kb = new InlineKeyboard();
    
    if (canCreate && codeCount < maxCodes) {
      kb.text("🎟️ ساخت دعوت‌نامه", "client:referral:generate").row();
    }
    
    kb.text("📊 وضعیت دعوت‌نامه‌ها", "client:referral:stats").row();
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
      .text("🧾 رسیدها", "mgr:receipts")
      .text("📦 سفارش‌ها", "mgr:allorders")
      .row()
      .text("🛍️ محصولات", "mgr:products")
      .text("👥 کاربران", "mgr:users")
      .row()
      .text("🚚 پیک‌ها", "mgr:couriers")
      .text("💬 پشتیبانی", "mgr:support")
      .row()
      .text("📣 اطلاع‌رسانی", "mgr:announcements")
      .row()
      .text("🎟️ دعوت‌نامه‌ها", "mgr:referrals")
      .text("📊 گزارش‌ها", "mgr:analytics")
      .row()
      .text("⚙️ تنظیمات", "mgr:settings")
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
      .text("📋 محصولات فعلی", "mgr:products:list")
      .row()
      .text("➕ افزودن محصول", "mgr:products:add")
      .row()
      .text("« بازگشت به منو", "mgr:menu");
  },

  /** Product creation wizard controls */
  productAddStep: (step: "title" | "description" | "price" | "stock" | "image") => {
    const kb = new InlineKeyboard();

    if (step === "description") {
      kb.text("رد کردن توضیحات", "mgr:productdraft:skip:description").row();
      kb.text("« مرحله قبل", "mgr:productdraft:back:title").row();
    } else if (step === "price") {
      kb.text("« مرحله قبل", "mgr:productdraft:back:description").row();
    } else if (step === "stock") {
      kb.text("نامحدود / نامشخص", "mgr:productdraft:skip:stock").row();
      kb.text("« مرحله قبل", "mgr:productdraft:back:price").row();
    } else if (step === "image") {
      kb.text("بدون تصویر", "mgr:productdraft:skip:image").row();
      kb.text("« مرحله قبل", "mgr:productdraft:back:stock").row();
    }

    kb.text("❌ انصراف", "mgr:productdraft:cancel");
    return kb;
  },

  /** Product creation preview actions */
  productAddPreview: () => {
    return new InlineKeyboard()
      .text("✅ ثبت محصول", "mgr:productdraft:confirm")
      .row()
      .text("📝 عنوان", "mgr:productdraft:edit:title")
      .text("📄 توضیحات", "mgr:productdraft:edit:description")
      .row()
      .text("💰 قیمت", "mgr:productdraft:edit:price")
      .text("📦 موجودی", "mgr:productdraft:edit:stock")
      .row()
      .text("🖼️ تصویر", "mgr:productdraft:edit:image")
      .row()
      .text("❌ انصراف", "mgr:productdraft:cancel")
      .text("« محصولات", "mgr:products");
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
      .text("⬆️ بالاتر", `mgr:product:move:${productId}:up`)
      .text("⬇️ پایین‌تر", `mgr:product:move:${productId}:down`)
      .row()
      .text("🔄 تغییر وضعیت", `mgr:product:toggle:${productId}`)
      .row()
      .text("« بازگشت به محصولات", "mgr:products:list");
    
    return kb;
  },

  /** User management menu */
  userManagement: () => {
    return new InlineKeyboard()
      .text("📋 کاربران", "mgr:users:list")
      .row()
      .text("🔍 جستجو", "mgr:users:search")
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
  userActions: (userId: number, isActive: boolean, canCreateReferral: boolean, discountLabel?: string, maxReferralCodes?: number, isTestUser = false) => {
    return new InlineKeyboard()
      .text("📦 سفارش‌ها", `mgr:user:orders:${userId}`)
      .text("📋 تماس و آدرس", `mgr:user:contact:${userId}`)
      .text("📍 موقعیت", `mgr:user:location:${userId}`)
      .row()
      .text("🎟️ دعوت‌نامه‌ها", `mgr:user:referrals:${userId}`)
      .text(
        canCreateReferral ? "🔒 بستن دعوت‌نامه" : "🔑 اجازه دعوت‌نامه",
        `mgr:user:toggleref:${userId}`
      )
      .row()
      .text(discountLabel && discountLabel !== "ندارد" ? `🎯 ${discountLabel}` : "🎯 تخفیف", `mgr:user:setdiscount:${userId}`)
      .text(`🔢 سقف دعوت: ${maxReferralCodes ?? 3}`, `mgr:user:setmaxcodes:${userId}`)
      .row()
      .text("⭐ امتیاز", `mgr:user:setscore:${userId}`)
      .text(
        isActive ? "🚫 مسدودسازی" : "✅ فعال‌سازی",
        `mgr:user:toggle:${userId}`
      )
      .row()
      .text(isTestUser ? "خروج از گروه آزمایشی" : "🧪 افزودن به گروه آزمایشی", `mgr:user:toggletest:${userId}`)
      .row()
      .text("💬 ارسال پیام", `mgr:user:message:${userId}`)
      .text("🗑️ حذف کاربر", `mgr:user:delete:${userId}`)
      .row()
      .text("« کاربران", "mgr:users:list")
      .text("« منو", "mgr:menu");
  },

  /** User discount shortcuts */
  userDiscountMenu: (userId: number, hasDiscount: boolean = false) => {
    const kb = new InlineKeyboard()
      .text("۵٪", `mgr:user:discount:pct:${userId}:5`)
      .text("۱۰٪", `mgr:user:discount:pct:${userId}:10`)
      .text("۱۵٪", `mgr:user:discount:pct:${userId}:15`)
      .text("۲۰٪", `mgr:user:discount:pct:${userId}:20`)
      .row()
      .text("درصد / مبلغ دلخواه", `mgr:user:discount:custom:${userId}`)
      .row();

    if (hasDiscount) {
      kb.text("حذف تخفیف", `mgr:user:discount:remove:${userId}`).row();
    }

    kb.text("« کاربر", `mgr:user:${userId}`).text("« منو", "mgr:menu");
    return kb;
  },

  /** Referral management menu */
  referralManagement: () => {
    return new InlineKeyboard()
      .text("📋 دعوت‌نامه‌ها", "mgr:referrals:list")
      .row()
      .text("➕ ساخت دعوت‌نامه", "mgr:referrals:create")
      .row()
      .text("📊 آمار", "mgr:referrals:stats")
      .row()
      .text("« بازگشت به منو", "mgr:menu");
  },

  /** Referral score choices for manager-created one-time invitations */
  referralScoreMenu: () => {
    return new InlineKeyboard()
      .text("بدون امتیاز", "mgr:referrals:create:score:0")
      .text("۳", "mgr:referrals:create:score:3")
      .text("۵", "mgr:referrals:create:score:5")
      .row()
      .text("۷", "mgr:referrals:create:score:7")
      .text("۱۰", "mgr:referrals:create:score:10")
      .text("مقدار دلخواه", "mgr:referrals:create:custom")
      .row()
      .text("« دعوت‌نامه‌ها", "mgr:referrals")
      .text("« منو", "mgr:menu");
  },

  /** Analytics menu */
  analyticsMenu: () => {
    return new InlineKeyboard()
      .text("📦 سفارش‌ها", "mgr:analytics:orders")
      .text("👥 کاربران", "mgr:analytics:users")
      .row()
      .text("🛍️ محصولات", "mgr:analytics:products")
      .text("🎟️ دعوت‌نامه‌ها", "mgr:analytics:referrals")
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

  settingsConfirm: (kind: "card" | "deliverymsg" | "expiry") => {
    return new InlineKeyboard()
      .text("✅ تأیید و ذخیره", `mgr:settings:confirm:${kind}`)
      .row()
      .text("✏️ ویرایش", `mgr:settings:${kind}`)
      .text("❌ انصراف", "mgr:settings");
  },

  announcementManagement: () => {
    return new InlineKeyboard()
      .text("⛔ اعلام تعطیلی", "mgr:announcement:create:CLOSURE")
      .row()
      .text("📣 اطلاعیه", "mgr:announcement:create:GENERAL")
      .row()
      .text("📋 اطلاعیه‌های فعال", "mgr:announcements:active")
      .row()
      .text("« بازگشت به منو", "mgr:menu");
  },

  announcementOptionalMessage: () => new InlineKeyboard()
    .text("بدون توضیح", "mgr:announcement:message:skip")
    .row()
    .text("❌ انصراف", "mgr:announcements"),

  announcementDiscount: () => new InlineKeyboard()
    .text("بدون تخفیف", "mgr:announcement:discount:none")
    .row()
    .text("درصدی", "mgr:announcement:discount:PERCENT")
    .text("مبلغ ثابت", "mgr:announcement:discount:FIXED")
    .row()
    .text("❌ انصراف", "mgr:announcements"),

  announcementAudience: () => new InlineKeyboard()
    .text("🧪 گروه آزمایشی", "mgr:announcement:audience:TEST")
    .row()
    .text("👥 همه کاربران", "mgr:announcement:audience:ALL")
    .row()
    .text("❌ انصراف", "mgr:announcements"),

  announcementDuration: () => {
    return new InlineKeyboard()
      .text("۱ روز", "mgr:announcement:duration:1")
      .text("۳ روز", "mgr:announcement:duration:3")
      .text("۷ روز", "mgr:announcement:duration:7")
      .row()
      .text("۳۰ روز", "mgr:announcement:duration:30")
      .text("بدون تاریخ پایان", "mgr:announcement:duration:none")
      .row()
      .text("مدت دلخواه", "mgr:announcement:duration:custom")
      .row()
      .text("❌ انصراف", "mgr:announcements");
  },

  announcementList: (announcements: { id: number; typeLabel: string }[]) => {
    const kb = new InlineKeyboard();
    announcements.forEach((announcement) => {
      kb.text(`🛑 توقف ${announcement.typeLabel}`, `mgr:announcement:deactivate:${announcement.id}`).row();
    });
    kb.text("« اطلاع‌رسانی", "mgr:announcements").text("« منو", "mgr:menu");
    return kb;
  },

  supportReplyPreview: (conversationId: number) => {
    return new InlineKeyboard()
      .text("✅ ارسال پاسخ", `mgr:support:replyconfirm:${conversationId}`)
      .row()
      .text("✏️ ویرایش متن", `mgr:support:reply:${conversationId}`)
      .text("❌ انصراف", `mgr:support:conv:${conversationId}`);
  },

  /** Chooser shown when the manager confirms a reply to a CLOSED conversation: deliberately reopen it (and send) or abandon the send. */
  supportReplyReopen: (conversationId: number) => {
    return new InlineKeyboard()
      .text("🔄 بازگشایی و ارسال", `mgr:support:reopensend:${conversationId}`)
      .row()
      .text("❌ انصراف", `mgr:support:cancelsend:${conversationId}`);
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

  receiptApprovalMenu: (receiptId: number) => {
    return new InlineKeyboard()
      .text("بدون پیام زمان", `mgr:receipt:approveeta:${receiptId}:none`)
      .row()
      .text("امروز ارسال می‌شود", `mgr:receipt:approveeta:${receiptId}:today`)
      .row()
      .text("تا ۲۴ ساعت آینده", `mgr:receipt:approveeta:${receiptId}:24h`)
      .row()
      .text("زمان دلخواه", `mgr:receipt:approveeta:${receiptId}:custom`)
      .row()
      .text("« رسید", `mgr:receipt:view:${receiptId}`)
      .text("« رسیدها", "mgr:receipts");
  },

  receiptRejectMenu: (receiptId: number) => {
    return new InlineKeyboard()
      .text("عکس رسید واضح نیست", `mgr:receipt:rejectreason:${receiptId}:blurred`)
      .row()
      .text("مبلغ پرداختی مطابقت ندارد", `mgr:receipt:rejectreason:${receiptId}:amount`)
      .row()
      .text("رسید مربوط به این سفارش نیست", `mgr:receipt:rejectreason:${receiptId}:wrong_order`)
      .row()
      .text("بدون توضیح", `mgr:receipt:rejectreason:${receiptId}:none`)
      .row()
      .text("دلیل دلخواه", `mgr:receipt:rejectreason:${receiptId}:custom`)
      .row()
      .text("« رسید", `mgr:receipt:view:${receiptId}`)
      .text("« رسیدها", "mgr:receipts");
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
      .text("🚚 مأموریت‌های امروز", "courier:deliveries")
      .row()
      .text("📋 تحویل‌شده‌ها", "courier:history")
      .row()
      .text("🔄 به‌روزرسانی", "courier:menu");
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
  deliveryActions: (deliveryId: number, currentStatus?: string, phone?: string | null) => {
    const kb = new InlineKeyboard();

    // Show only the logical next status transitions
    if (!currentStatus || currentStatus === "ASSIGNED") {
      kb.text("📦 بسته را گرفتم", `courier:status:${deliveryId}:PICKED_UP`).row();
    }
    if (!currentStatus || currentStatus === "ASSIGNED" || currentStatus === "PICKED_UP") {
      kb.text("🛵 به سمت مشتری می‌روم", `courier:status:${deliveryId}:OUT_FOR_DELIVERY`).row();
    }
    if (!currentStatus || (currentStatus !== "DELIVERED" && currentStatus !== "FAILED")) {
      kb.text("✅ تحویل دادم", `courier:status:${deliveryId}:DELIVERED`).row();
      kb.text("❌ مشکل در تحویل", `courier:status:${deliveryId}:FAILED`).row();
    }

    // Location button
    kb.text("📍 آدرس روی نقشه", `courier:location:${deliveryId}`).row();

    // Native Telegram contact card — reliably tappable/callable, immune to RTL rendering
    if (normalizeIranianPhone(phone)) {
      kb.text("📞 تماس با مشتری", `courier:contact:${deliveryId}`).row();
    }

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
