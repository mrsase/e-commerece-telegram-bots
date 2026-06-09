import { formatPrice } from "../utils/format-price.js";

/**
 * Centralized text management for Amoosh Telegram Bots
 * 
 * All user-facing messages are defined here for easy modification.
 * To customize texts, edit the values in this file.
 * 
 * Usage:
 *   import { ClientTexts, ManagerTexts, escapeMarkdown } from "../i18n/texts.js";
 *   await ctx.reply(ClientTexts.welcome());
 */

/**
 * P2-2 Fix: Escape special characters for Telegram Markdown
 * This prevents user-generated content from breaking message formatting.
 */
export function escapeMarkdown(text: string | null | undefined): string {
  if (!text) return '';
  // Escape Markdown V1 special characters: _ * ` [
  return text.replace(/([_*`\[])/g, '\\$1');
}

/**
 * P2-2 Fix: Escape for MarkdownV2 (more strict escaping)
 */
export function escapeMarkdownV2(text: string | null | undefined): string {
  if (!text) return '';
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

// ===========================================
// CLIENT BOT TEXTS
// ===========================================

export const ClientTexts = {
  // Referral Gate
  welcomeNewUser: () => "برای استفاده از فروشگاه لطفا کد ورود را وارد کنید",
  invalidReferralCode: () => "❌ کد معرفی نامعتبر یا منقضی است. دوباره تلاش کنید:",
  referralCodeAccepted: () => "کد معرفی تایید شد، به فروشگاه ایرانی خوش آمدید",
  userBlocked: () => "🚫 حساب شما مسدود شده است. لطفاً با پشتیبانی تماس بگیرید.",

  // Welcome & Start
  welcome: () => "به فروشگاه آموز خوش آمدید. از منوی زیر برای ادامه استفاده کنید.",
  welcomeBack: (name: string) => `سلام ${name}! 👋`,

  // Products
  noProductsAvailable: () => "فعلاً محصولی برای نمایش وجود ندارد.",
  productsHeader: () => "محصولات موجود:",
  productLine: (title: string, price: number, _currency?: string) =>
    `${title} - ${formatPrice(price)}`,

  // Cart
  cartEmpty: () => "سبد خرید شما خالی است.",
  cartHeader: () => "سبد خرید شما:",
  cartItemLine: (title: string, qty: number, lineTotal: number, _currency?: string) =>
    `${title} x ${qty} = ${formatPrice(lineTotal)}`,
  cartSubtotal: (subtotal: number) => `جمع: ${formatPrice(subtotal)}`,

  // Add to Cart
  addUsage: () => "فرمت: /add <شناسه محصول> <تعداد>",
  productNotFound: () => "محصول پیدا نشد.",
  addedToCart: (title: string, qty: number) => `به سبد خرید اضافه شد: ${title} x ${qty}.`,

  // Remove from Cart
  removeUsage: () => "فرمت: /remove <شناسه محصول>",
  productNotInCart: () => "این محصول در سبد خرید شما نیست.",
  removedFromCart: (title: string) => `از سبد خرید حذف شد: ${title}.`,

  // Checkout
  orderSubmitted: (orderId: number, grandTotal: number) =>
    `✅ سفارش شما ثبت شد! شماره: ${orderId}، مبلغ: ${formatPrice(grandTotal)}.\n\n🙏 دوست عزیز، لطفاً تا لحظه‌ای که سفارشت به دستت می‌رسه، پیام‌های ربات رو چک کن. تمام هماهنگی‌های ارسال از طریق همین ربات انجام می‌شه 🌷`,
  orderSubmittedWithDiscount: (orderId: number, grandTotal: number, subtotal: number, discount: number) =>
    `✅ سفارش شما ثبت شد! شماره: ${orderId}\n\n💰 مبلغ بدون تخفیف: ${formatPrice(subtotal)}\n🎁 تخفیف ویژه: ${formatPrice(discount)}-\n💳 مبلغ نهایی: ${formatPrice(grandTotal)}\n\nاین تخفیف توسط مدیریت برای شما اعمال شده است.\n\n🙏 دوست عزیز، لطفاً تا لحظه‌ای که سفارشت به دستت می‌رسه، پیام‌های ربات رو چک کن. تمام هماهنگی‌های ارسال از طریق همین ربات انجام می‌شه 🌷`,
  outOfStock: () => "متأسفانه برخی اقلام موجود نیستند. لطفاً سبد خرید را اصلاح کنید.",
  checkoutError: () => "ثبت سفارش با خطا مواجه شد. لطفاً بعداً دوباره تلاش کنید.",

  // Errors
  unableToIdentify: () => "امکان شناسایی شما وجود ندارد.",

  // Referrals
  myReferralCode: (code: string) => `🔗 کد معرفی شما: \`${code}\``,
  noReferralCode: () => "شما هنوز کد معرفی ایجاد نکرده‌اید.",
  referralCodeGenerated: (code: string) => `✅ کد معرفی جدید شما: \`${code}\`\n\nاین کد را برای دوستانتان ارسال کنید.`,
  referralStats: (count: number) => `📊 تعداد معرفی‌های شما: ${count} نفر`,
  
  // Product View
  productDetails: (title: string, description: string | null, price: number, _currency?: string, stock?: number | null) =>
    `*${escapeMarkdown(title)}*\n\n${escapeMarkdown(description) || 'بدون توضیحات'}\n\n💰 قیمت: ${formatPrice(price)}${stock !== null ? `\n📦 موجودی: ${stock}` : ''}`,
  selectQuantity: () => "تعداد را انتخاب کنید:",
  addedToCartSuccess: (title: string, qty: number) => `✅ ${qty} عدد ${title} به سبد خرید اضافه شد!`,
  
  // Orders
  myOrdersHeader: () => "📦 سفارش‌های شما:",
  noOrders: () => "شما هنوز سفارشی ثبت نکرده‌اید.",
  orderDetails: (id: number, status: string, total: number) =>
    `سفارش #${id}\nوضعیت: ${status}\nمبلغ: ${formatPrice(total)}`,
  
  // Cart Cleared
  cartCleared: () => "🗑️ سبد خرید شما خالی شد.",

  // Pre-checkout Info Gathering
  checkoutInfoRequired: () => "📋 قبل از ثبت سفارش، لطفاً اطلاعات زیر را تکمیل کنید:",
  askPhone: () => "📱 لطفاً شماره تماس خود را ارسال کنید:\n\nمی‌توانید از دکمه «ارسال شماره تماس» برای اشتراک‌گذاری خودکار استفاده کنید، یا دکمه «تایپ دستی» را بزنید و شماره را به صورت متن وارد کنید:",
  askPhoneButton: () => "📱 ارسال شماره تماس",
  askPhoneManualButton: () => "✏️ تایپ دستی شماره",
  askPhoneManualPrompt: () => "📱 لطفاً شماره تلفن خود را به صورت کامل وارد کنید (مثلاً: 09123456789):",
  phoneReceived: () => "✅ شماره تماس ثبت شد.",
  invalidPhone: () => "❌ شماره تلفن نامعتبر است. لطفاً یک شماره معتبر با فرمت 09123456789 وارد کنید:",
  askLocation: () => "📍 لطفاً موقعیت مکانی خود را ارسال کنید:\n\nمی‌توانید از دکمه زیر برای ارسال موقعیت فعلی خود استفاده کنید، از طریق منوی پیوست (📎) هر نقطه دیگری را روی نقشه انتخاب کنید و ارسال نمایید، یا دکمه «تایپ دستی» را بزنید و موقعیت را به صورت متن وارد کنید:",
  askLocationButton: () => "📍 ارسال موقعیت فعلی",
  askLocationManualButton: () => "✏️ تایپ دستی موقعیت",
  askLocationManualPrompt: () => "📍 لطفاً موقعیت خود را به صورت متن وارد کنید (مثلاً: تهران، میدان انقلاب):",
  locationReceived: () => "✅ موقعیت مکانی ثبت شد.",
  invalidLocation: () => "❌ لطفاً موقعیت مکانی را از طریق دکمه زیر یا منوی پیوست (📎) ارسال کنید:",
  askAddress: () => "🏠 لطفاً آدرس کامل را به صورت متن ارسال کنید:",
  addressReceived: () => "✅ آدرس ثبت شد.",
  infoComplete: () => "✅ اطلاعات کامل شد. در حال ثبت سفارش...",
  skipInfo: () => "رد کردن",
  cancelCheckout: () => "❌ ثبت سفارش لغو شد.",

  // Order Status Updates
  orderApproved: (orderId: number) => `✅ خبر خوب! سفارش #${orderId} تأیید شد.`,
  orderRejected: (orderId: number, reason?: string) => 
    `❌ سفارش #${orderId} تأیید نشد.${reason ? `\n\nعلت: ${reason}` : ''}`,

  // Receipt Submission
  sendReceiptPrompt: () => "📸 لطفاً عکس رسید پرداخت را ارسال کنید:",
  receiptReceived: () => "✅ رسید دریافت شد. مدیر به‌زودی بررسی می‌کند.",
  receiptApproved: (orderId: number, etaText?: string) =>
    `✅ رسید سفارش #${orderId} تأیید شد.${etaText ? `\n\n${etaText}` : ''}\n\n🙏 دوست عزیز، لطفاً تا لحظه‌ای که سفارشت به دستت می‌رسه، پیام‌های ربات رو چک کن. تمام هماهنگی‌های ارسال از طریق همین ربات انجام می‌شه 🌷`,
  receiptRejected: (orderId: number, reason?: string) => 
    `❌ رسید سفارش #${orderId} تأیید نشد.${reason ? `\n\nعلت: ${reason}` : ''}\n\nلطفاً یک عکس جدید از رسید ارسال کنید.`,
  noActiveOrderForReceipt: () => "❌ سفارشی که منتظر رسید باشد ندارید.",

  // Support / Chat
  supportTitle: () => "💬 پشتیبانی",
  supportIntro: () => "شما وارد بخش پشتیبانی شدید. پیام خود را ارسال کنید تا مدیر پاسخ دهد.",
  supportAskMessage: () => "✍️ لطفاً پیام خود را ارسال کنید:",
  supportMessageSent: () => "✅ پیام شما به پشتیبانی ارسال شد.",
  supportClosed: () => "✅ گفتگو بسته شد. در صورت نیاز دوباره از پشتیبانی استفاده کنید.",
  supportReplyFromManager: (text: string) => `💬 پاسخ پشتیبانی:\n\n${text}`,

  // Help
  helpMessage: () => `
🛒 *راهنمای فروشگاه ایرانی*

برای استفاده از ربات نیازی به تایپ کردن دستورها نیست؛
از دکمه‌های منو استفاده کنید.

*مراحل سفارش:*
1) از بخش «محصولات» کالاها را انتخاب کنید.
2) در «سبد خرید» اقلام را بررسی کنید.
3) «ثبت سفارش» را بزنید و اطلاعات تماس/آدرس را تکمیل کنید.
4) پس از ثبت سفارش، اطلاعات پرداخت برای شما ارسال می‌شود.
5) عکس رسید را در ربات ارسال کنید تا مدیر سفارش را تأیید کند.

برای ارتباط با پشتیبانی، از دکمه «پشتیبانی» استفاده کنید.
`.trim(),
};

// ===========================================
// MANAGER BOT TEXTS
// ===========================================

export const ManagerTexts = {
  // Authorization
  notAuthorized: () => "شما اجازه استفاده از این ربات را ندارید.",

  // Start & Welcome
  welcome: (pendingCount: number) => `سلام مدیر محترم. سفارش‌های در انتظار بررسی: ${pendingCount}.`,

  // Pending Orders
  noPendingOrders: () => "هیچ سفارشی برای بررسی وجود ندارد.",
  pendingOrdersHeader: () => "سفارش‌های در انتظار بررسی:",
  pendingOrderLine: (orderId: number, userId: number, grandTotal: number) =>
    `#${orderId} – کاربر ${userId} – مبلغ ${formatPrice(grandTotal)}`,

  // Approve Order
  approveUsage: () => "فرمت: /approve_order <شماره سفارش>",
  orderNotFound: () => "سفارش پیدا نشد یا در وضعیت بررسی نیست.",
  orderApproved: (orderId: number) => `سفارش #${orderId} تأیید شد.`,

  // Reject Order
  rejectUsage: () => "فرمت: /reject_order <شماره سفارش>",
  orderRejected: (orderId: number) => `سفارش #${orderId} رد شد.`,

  // Help
  helpMessage: () => `
👔 *راهنمای مدیر - فروشگاه ایرانی*

برای کار با ربات مدیریتی، از دکمه‌های منو استفاده کنید.
*مهم‌ترین بخش‌ها:*

- «رسیدها»: بررسی و تأیید/رد رسیدهای پرداخت کاربران
- «همه سفارش‌ها»: مشاهده وضعیت تمام سفارش‌ها
- «محصولات»: افزودن/ویرایش/غیرفعال‌سازی محصول
- «پشتیبانی»: صندوق پیام‌های کاربران و پاسخ‌دهی
`.trim(),

  // UI Messages
  mainMenuTitle: () => "👔 *داشبورد مدیریت*\n\nیک گزینه را انتخاب کنید:",
  
  // Products Management
  productsMenuTitle: () => "📦 *مدیریت محصولات*",
  productListTitle: () => "📦 *لیست محصولات*",
  noProducts: () => "هیچ محصولی یافت نشد.",
  productCreated: (title: string) => `✅ محصول «${title}» با موفقیت ایجاد شد.`,
  productUpdated: () => "✅ محصول با موفقیت به‌روزرسانی شد.",
  productDeleted: () => "✅ محصول غیرفعال شد.",
  enterProductTitle: () => "عنوان محصول را وارد کنید:",
  enterProductDescription: () => "توضیحات محصول را وارد کنید:",
  enterProductPrice: () => "قیمت محصول را وارد کنید (فقط عدد):",
  enterProductStock: () => "موجودی اولیه را وارد کنید (فقط عدد):",
  sendProductImage: () => "عکس محصول را ارسال کنید:",
  invalidNumber: () => "❌ لطفاً یک عدد معتبر وارد کنید.",

  // User Management
  usersMenuTitle: () => "👥 *مدیریت کاربران*",
  userListTitle: () => "👥 *لیست کاربران*",
  noUsers: () => "هیچ کاربری یافت نشد.",
  userDetails: (id: number, username: string | null, isActive: boolean, orderCount: number, canCreateReferral: boolean, effectiveScore: number, hasOverride: boolean, discountPercent?: number | null) =>
    `*کاربر #${id}*\n\nنام کاربری: ${escapeMarkdown(username) || '—'}\nوضعیت: ${isActive ? '✅ فعال' : '🚫 مسدود'}\nمجوز معرفی: ${canCreateReferral ? '✅ دارد' : '❌ ندارد'}\n⭐ امتیاز وفاداری: ${effectiveScore}/10${hasOverride ? ' (بازنویسی مدیر)' : ''}\n🎯 تخفیف: ${discountPercent != null ? `${discountPercent}%` : 'ندارد'}\nتعداد سفارش: ${orderCount}`,
  userBlocked: (username: string | null) => `🚫 کاربر ${username || 'نامشخص'} مسدود شد.`,
  userUnblocked: (username: string | null) => `✅ کاربر ${username || 'نامشخص'} رفع مسدود شد.`,
  userReferralGranted: (username: string | null) => `🔑 مجوز ساخت کد معرفی به ${username || 'کاربر'} داده شد.`,
  userReferralRevoked: (username: string | null) => `🔒 مجوز ساخت کد معرفی از ${username || 'کاربر'} گرفته شد.`,
  userDeleted: (username: string | null) => `🗑️ کاربر ${username || 'نامشخص'} حذف شد.`,
  userDeleteConfirm: (username: string | null) => `⚠️ آیا از حذف کاربر ${username || 'نامشخص'} مطمئن هستید؟ این عمل غیرقابل بازگشت است.`,
  enterSearchQuery: () => "نام کاربری یا شناسه تلگرام را وارد کنید:",
  enterUserScore: () => "امتیاز جدید (۰ تا ۱۰) را وارد کنید:",
  userScoreUpdated: (score: number) => `⭐ امتیاز کاربر به ${score} تغییر یافت.`,

  // Loyalty Score
  enterReferralScore: () => "⭐ امتیاز وفاداری (۰ تا ۱۰) را برای کاربران این کد وارد کنید:",
  invalidScore: () => "❌ امتیاز باید عددی بین ۰ تا ۱۰ باشد.",

  // User Discount
  enterUserDiscount: () => "🎯 درصد تخفیف جدید را وارد کنید (۰ تا ۱۰۰):",
  invalidDiscountPercent: () => "❌ درصد تخفیف باید عددی بین ۰ تا ۱۰۰ باشد.",

  // Courier Management
  couriersMenuTitle: () => "🚚 *مدیریت پیک‌ها*",
  courierListTitle: () => "🚚 *لیست پیک‌ها*",
  noCouriers: () => "هیچ پیکی یافت نشد.",
  courierDetails: (id: number, username: string | null, tgUserId: bigint, isActive: boolean) =>
    `*پیک #${id}*\n\nنام کاربری: ${escapeMarkdown(username) || '—'}\nشناسه تلگرام: \`${tgUserId}\`\nوضعیت: ${isActive ? '✅ فعال' : '🚫 غیرفعال'}`,
  courierAdded: (tgUserId: string) => `✅ پیک با شناسه تلگرام ${tgUserId} اضافه شد.`,
  courierAlreadyExists: () => "این شناسه تلگرام قبلاً به عنوان پیک ثبت شده است.",
  courierToggled: (username: string | null, isActive: boolean) =>
    isActive ? `✅ پیک ${username || 'نامشخص'} فعال شد.` : `🚫 پیک ${username || 'نامشخص'} غیرفعال شد.`,
  courierDeleted: (username: string | null) => `🗑️ پیک ${username || 'نامشخص'} حذف شد.`,
  enterCourierTgId: () => "شناسه تلگرام پیک را وارد کنید (عدد):",
  invalidTgId: () => "❌ شناسه تلگرام باید یک عدد معتبر باشد.",

  // Referral Management
  referralsMenuTitle: () => "🔗 *مدیریت کدهای معرفی*",
  referralListTitle: () => "🔗 *لیست کدهای معرفی*",
  noReferralCodes: () => "هیچ کد معرفی یافت نشد.",
  referralCodeCreated: (code: string) => `✅ کد معرفی ایجاد شد: \`${code}\``,
  referralCodeDeactivated: () => "✅ کد معرفی غیرفعال شد.",
  enterReferralMaxUses: () => "حداکثر تعداد استفاده را وارد کنید:",

  // Analytics
  analyticsMenuTitle: () => "📊 *داشبورد آمار*\n\nهر کدام از بخش‌ها را انتخاب کنید:",
  orderAnalytics: (total: number, statusBreakdown: Record<string, number>, revenue: number, todayOrders: number, todayRevenue: number, weekOrders: number, weekRevenue: number, monthOrders: number, monthRevenue: number) => {
    let text = `📦 *آمار سفارش‌ها*\n\n`;
    text += `📊 *وضعیت‌ها*\n`;
    text += `─────────────────\n`;
    for (const [label, count] of Object.entries(statusBreakdown)) {
      if (count > 0) text += `${label}: ${count}\n`;
    }
    text += `\n💰 *فروش کلی:* ${formatPrice(revenue)}\n\n`;
    text += `─────────────────\n`;
    text += `📅 *امروز*\n`;
    text += `   سفارش‌ها: ${todayOrders}\n`;
    text += `   فروش: ${formatPrice(todayRevenue)}\n\n`;
    text += `📅 *این هفته*\n`;
    text += `   سفارش‌ها: ${weekOrders}\n`;
    text += `   فروش: ${formatPrice(weekRevenue)}\n\n`;
    text += `📅 *این ماه*\n`;
    text += `   سفارش‌ها: ${monthOrders}\n`;
    text += `   فروش: ${formatPrice(monthRevenue)}\n\n`;
    text += `📅 *کل*\n`;
    text += `   سفارش‌ها: ${total}\n`;
    text += `   فروش: ${formatPrice(revenue)}`;
    return text;
  },
  userAnalytics: (total: number, verified: number, active: number, blocked: number, newToday: number, newThisWeek: number, newThisMonth: number) =>
    `👥 *آمار کاربران*\n\n` +
    `👤 کل کاربران: ${total}\n` +
    `✅ تأییدشده: ${verified}\n` +
    `🟢 فعال: ${active}\n` +
    `🚫 مسدود: ${blocked}\n` +
    `─────────────────\n` +
    `📅 *امروز:* ${newToday} کاربر جدید\n` +
    `📅 *این هفته:* ${newThisWeek} کاربر جدید\n` +
    `📅 *این ماه:* ${newThisMonth} کاربر جدید`,
  productAnalytics: (total: number, active: number, inactive: number, outOfStock: number, lowStock: number) =>
    `📦 *آمار محصولات*\n\n` +
    `📦 کل محصولات: ${total}\n` +
    `✅ فعال: ${active}\n` +
    `❌ غیرفعال: ${inactive}\n` +
    `⛔ ناموجود: ${outOfStock}\n` +
    `⚠️ کم‌موجودی (<۵): ${lowStock}`,
  productSalesAnalytics: (totalQty: number, totalRevenue: number, products: { title: string; qty: number; revenue: number }[]) => {
    let text = `📦 *آمار فروش محصولات*\n\n`;
    text += `📊 *جمع کل*\n`;
    text += `   تعداد فروش: ${totalQty}\n`;
    text += `   درآمد: ${formatPrice(totalRevenue)}\n`;
    text += `─────────────────\n\n`;
    if (products.length === 0) {
      text += "هنوز فروشی ثبت نشده.\n";
    } else {
      products.forEach((p, i) => {
        text += `${i + 1}. ${escapeMarkdown(p.title)}\n`;
        text += `   ❯ ${p.qty} عدد · ${formatPrice(p.revenue)}\n`;
      });
    }
    return text;
  },
  referralAnalytics: (totalCodes: number, activeCodes: number, totalUses: number, referredUsers: number, avgUses: string, topReferrer: string | null) =>
    `🔗 *آمار معرفی*\n\n` +
    `📋 کل کدها: ${totalCodes}\n` +
    `✅ کدهای فعال: ${activeCodes}\n` +
    `📊 کل استفاده: ${totalUses}\n` +
    `👥 کاربران معرفی‌شده: ${referredUsers}\n` +
    `📈 میانگین استفاده: ${avgUses}\n` +
    `🏆 بهترین معرف: ${topReferrer || '—'}`,

  // Confirmations
  confirmDelete: (item: string) => `⚠️ آیا از حذف ${item} مطمئن هستید؟`,
  actionCancelled: () => "عملیات لغو شد.",

  // Receipt Management
  pendingReceiptsTitle: () => "🧾 *رسیدهای در انتظار بررسی*",
  noPendingReceipts: () => "هیچ رسیدی برای بررسی وجود ندارد.",
  receiptDetails: (orderId: number, userId: number, username: string | null, submittedAt: string) =>
    `🧾 *رسید سفارش #${orderId}*\n\nکاربر: ${username || `#${userId}`}\nزمان ارسال: ${submittedAt}`,
  receiptApproved: (orderId: number) => `✅ رسید سفارش #${orderId} تأیید شد.`,
  receiptRejected: (orderId: number) => `❌ رسید سفارش #${orderId} رد شد.`,
  enterRejectReason: () => "علت رد را وارد کنید:",
  enterEtaMessage: () => "⏰ پیام زمان تقریبی تحویل را وارد کنید:\n\nاین پیام پس از تأیید برای کاربر ارسال می‌شود.\n(برای رد کردن، /skip را ارسال کنید)",

  // Support / Chat
  supportInboxTitle: () => "💬 *صندوق پشتیبانی*",
  noSupportConversations: () => "هیچ گفتگوی بازِ پشتیبانی وجود ندارد.",
  supportConversationTitle: (conversationId: number) => `💬 *گفتگو #${conversationId}*`,
  supportAskReply: () => "✍️ پاسخ را ارسال کنید:",
  supportReplySent: () => "✅ پاسخ ارسال شد.",
  supportConversationClosed: () => "✅ گفتگو بسته شد.",
  supportNewMessageNotification: (conversationId: number, fromLabel: string) =>
    `📩 پیام جدید پشتیبانی\nگفتگو #${conversationId}\nاز: ${fromLabel}`,
  productNotFound: () => "محصول پیدا نشد.",
  productDeactivated: () => "محصول غیرفعال شد.",
  productActivated: () => "محصول فعال شد.",
  invalidDeliveryOrStatus: () => "مقدار نامعتبر است.",
  
  // User Info Display
  userContactInfo: (phone: string | null, address: string | null, lat: number | null, lng: number | null, locationText?: string | null) =>
    `📋 *اطلاعات مشتری:*\nتلفن: ${escapeMarkdown(phone) || '—'}\nآدرس: ${escapeMarkdown(address) || '—'}${lat != null && lng != null ? `\n📍 موقعیت: ${lat.toFixed(6)}, ${lng.toFixed(6)}` : locationText ? `\n📍 موقعیت: ${escapeMarkdown(locationText)}` : ''}`,

  // Settings
  settingsMenuTitle: (imageStatus: string, cardStatus?: string, deliveryMsgStatus?: string) =>
    `⚙️ *تنظیمات ربات*\n\n🖼️ تصویر پرداخت: ${imageStatus}\n🏦 شماره کارت: ${cardStatus || '❌ تنظیم نشده'}\n🚚 پیام ارسال: ${deliveryMsgStatus || '❌ تنظیم نشده'}`,
  settingsImageUpdated: () => "✅ تصویر پرداخت با موفقیت به‌روزرسانی شد.",
  settingsImageDeleted: () => "✅ تصویر پرداخت حذف شد. از این پس فقط متن ارسال می‌شود.",
  settingsImageAsk: () => "🖼️ تصویر پرداخت را ارسال کنید (عکسی که در کانال نمایش داده می‌شود):",
  settingsExpiryAsk: () => "⏳ مهلت پرداخت را به دقیقه وارد کنید (مثلاً 60):",
  settingsExpiryUpdated: (minutes: number) => `✅ مهلت پرداخت به ${minutes} دقیقه تغییر یافت.`,
  settingsExpiryInvalid: () => "❌ لطفاً یک عدد معتبر (بزرگتر از صفر) وارد کنید.",
  // Card Number Settings
  settingsCardAsk: () => "💳 شماره کارت ۱۶ رقمی را وارد کنید (بدون فاصله یا خط تیره):\n\nبرای پاک کردن شماره کارت، /delete را ارسال کنید.",
  settingsCardUpdated: (cardNumber: string) => `✅ شماره کارت به \`${cardNumber}\` تغییر یافت.`,
  settingsCardDeleted: () => "✅ شماره کارت حذف شد. پیام پرداخت بدون شماره کارت ارسال می‌شود.",

  // Courier Message Settings
  settingsDeliveryMsgAsk: () => "📝 پیام ارسالی به کاربر هنگام «در مسیر ارسال» شدن را وارد کنید:\n\nاین پیام به کاربر اعلام می‌کند که پیک در مسیر است.\n(برای پاک کردن، /delete را ارسال کنید)",
  settingsDeliveryMsgUpdated: (msg: string) => `✅ پیام ارسال به‌روزرسانی شد:\n\n${msg}`,
  settingsDeliveryMsgDeleted: () => "✅ پیام سفارشی حذف شد. فقط وضعیت استاندارد ارسال می‌شود.",
  settingsCardInvalid: () => "❌ شماره کارت باید ۱۶ رقمی و فقط شامل اعداد باشد. دوباره تلاش کنید:",
};

export const CourierTexts = {
  notAuthorized: () => "شما به عنوان پیک مجاز نیستید.",
  dashboardTitle: () => "داشبورد پیک",
  deliveriesTitle: () => "ارسال‌های شما",
  noDeliveries: () => "هیچ ارسال اختصاص‌داده‌شده‌ای ندارید.",
  deliveryDetails: (params: {
    orderId: number;
    status: string;
    customerName: string;
    phone: string;
    address: string;
    locationLat?: number | null;
    locationLng?: number | null;
    locationText?: string | null;
  }) => {
    const lines = [
      `🚚 ارسال سفارش #${params.orderId}`,
      `━━━━━━━━━━━━━━━`,
      `📌 وضعیت: ${params.status}`,
      ``,
      `👤 مشتری: ${params.customerName}`,
      `📱 تلفن: ${params.phone}`,
      `🏠 آدرس: ${params.address}`,
    ];
    if (params.locationLat != null && params.locationLng != null) {
      lines.push(`📍 موقعیت: ثبت شده`);
    } else if (params.locationText) {
      lines.push(`📍 موقعیت: ${params.locationText}`);
    } else {
      lines.push(`📍 موقعیت: ثبت نشده`);
    }
    return lines.join("\n");
  },
  askFailureReason: () => "علت عدم موفقیت را به صورت پیام ارسال کنید.",
  statusUpdated: (status: string) => `وضعیت به‌روزرسانی شد: ${status}`,
  failureReasonSaved: () => "علت ثبت شد.",
  invalidDelivery: () => "ارسال نامعتبر است.",
  notFound: () => "یافت نشد.",
  updated: () => "ثبت شد.",
  askFailureReasonEmpty: () => "لطفاً علت را ارسال کنید.",
  statusAssigned: () => "اختصاص داده شده",
  statusPickedUp: () => "تحویل گرفته شد",
  statusOutForDelivery: () => "در مسیر ارسال",
  statusDelivered: () => "تحویل شد",
  statusFailed: () => "ناموفق",
};

// ===========================================
// CHANNEL TEXTS (posted inside the checkout channel)
// ===========================================

export const ChannelTexts = {
  paymentMessage: (orderId: number, grandTotal: number, cardNumber?: string, _currency?: string) =>
    `💳 *پرداخت سفارش #${orderId}*\n\n` +
    `مبلغ قابل پرداخت: *${formatPrice(grandTotal)}*\n\n` +
    (cardNumber ? `🏦 شماره کارت: \`${cardNumber}\`\n\n` : '') +
    `لطفاً مبلغ فوق را به شماره کارت ذکر شده واریز کنید ` +
    `و سپس عکس رسید را در ربات فروشگاه ارسال نمایید.\n\n` +
    `⏳ این پیام پس از ثبت رسید یا اتمام مهلت پرداخت حذف خواهد شد.\n\n` +
    `🙏 دوست عزیز، لطفاً تا لحظه‌ای که سفارشت به دستت می‌رسه، پیام‌های ربات رو چک کن. تمام هماهنگی‌های ارسال از طریق همین ربات انجام می‌شه 🌷`,
};
