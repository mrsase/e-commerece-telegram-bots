import { formatPrice } from "../utils/format-price.js";

/**
 * Centralized text management for فروشگاه ایرانی Telegram Bots
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
  welcomeNewUser: () => "برای ورود به فروشگاه ایرانی، لطفاً کد معرفی خود را وارد کنید:",
  invalidReferralCode: () => "❌ کد معرفی نامعتبر است یا قبلاً استفاده شده. لطفاً کد دیگری وارد کنید:",
  referralCodeAccepted: () => "✅ کد معرفی تأیید شد. به فروشگاه ایرانی خوش آمدید.",
  userBlocked: () => "🚫 حساب شما مسدود شده است. لطفاً با پشتیبانی تماس بگیرید.",

  // Welcome & Start
  welcome: () => "به فروشگاه ایرانی خوش آمدید. از منوی زیر برای ادامه استفاده کنید.",
  welcomeBack: (name: string) => `سلام ${name}! 👋`,

  // Products
  noProductsAvailable: () => "فعلاً محصولی برای نمایش وجود ندارد.",
  productsHeader: () => "محصولات موجود:",
  productLine: (title: string, price: number, currency?: string) =>
    `${title} - ${formatPrice(price)}${currency && currency !== "IRR" ? ` ${currency}` : ""}`,

  // Cart
  cartEmpty: () => "سبد خرید شما خالی است.",
  cartHeader: () => "سبد خرید شما:",
  cartItemLine: (title: string, qty: number, lineTotal: number, currency?: string) =>
    `${title} x ${qty} = ${formatPrice(lineTotal)}${currency && currency !== "IRR" ? ` ${currency}` : ""}`,
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
    `✅ سفارش شما ثبت شد.\nشماره سفارش: ${orderId}\nمبلغ قابل پرداخت: ${formatPrice(grandTotal)}\n\nاطلاعات پرداخت در پیام بعدی ارسال می‌شود. لطفاً پس از پرداخت، عکس رسید را همین‌جا ارسال کنید.\n\n🙏 تا زمان تحویل سفارش، پیام‌های ربات را دنبال کنید؛ هماهنگی‌های ارسال از همین‌جا انجام می‌شود.`,
  orderSubmittedWithDiscount: (orderId: number, grandTotal: number, subtotal: number, discount: number) =>
    `✅ سفارش شما ثبت شد.\nشماره سفارش: ${orderId}\n\n💰 مبلغ قبل از تخفیف: ${formatPrice(subtotal)}\n🎁 تخفیف اختصاصی شما: ${formatPrice(discount)}\n💳 مبلغ قابل پرداخت: ${formatPrice(grandTotal)}\n\nاطلاعات پرداخت در پیام بعدی ارسال می‌شود. لطفاً پس از پرداخت، عکس رسید را همین‌جا ارسال کنید.\n\n🙏 تا زمان تحویل سفارش، پیام‌های ربات را دنبال کنید؛ هماهنگی‌های ارسال از همین‌جا انجام می‌شود.`,
  outOfStock: () => "متأسفانه برخی اقلام موجود نیستند. لطفاً سبد خرید را اصلاح کنید.",
  checkoutError: () => "ثبت سفارش با خطا مواجه شد. لطفاً بعداً دوباره تلاش کنید.",

  // Errors
  unableToIdentify: () => "امکان شناسایی شما وجود ندارد.",

  // Referrals
  myReferralCode: (code: string) => `🔗 کد معرفی یک‌بارمصرف شما: \`${code}\``,
  noReferralCode: () => "شما هنوز کد معرفی یک‌بارمصرف ایجاد نکرده‌اید.",
  referralCodeGenerated: (code: string) => `✅ کد معرفی یک‌بارمصرف شما ساخته شد:\n\`${code}\`\n\nاین کد را فقط برای یک نفر ارسال کنید؛ بعد از اولین ورود، منقضی می‌شود.`,
  referralStats: (count: number) => `📊 تعداد کدهای استفاده‌شده شما: ${count}`,
  referralNoPermission: () => "فعلاً مجوز ساخت کد معرفی یک‌بارمصرف برای شما فعال نیست. برای پیگیری با پشتیبانی تماس بگیرید.",
  referralMaxCodesReached: (max: number) => `شما حداکثر می‌توانید ${max} کد معرفی یک‌بارمصرف بسازید.`,
  enterReferralScore: () => "⭐ امتیاز وفاداری (۰ تا ۱۰) را برای کاربری که این دعوت‌نامه را استفاده می‌کند وارد کنید.\nبرای رد شدن /skip بزنید.\nبرای لغو، /cancel را ارسال کنید:",
  invalidReferralScore: () => "❌ امتیاز باید عددی بین ۰ تا ۱۰ باشد. دوباره وارد کنید:",
  
  // Product View
  productDetails: (title: string, description: string | null, price: number, _currency?: string, stock?: number | null) =>
    `*${escapeMarkdown(title)}*\n\n${escapeMarkdown(description) || 'بدون توضیحات'}\n\n💰 قیمت: ${formatPrice(price)}${stock !== null ? `\n📦 موجودی: ${stock}` : ''}`,
  selectQuantity: () => "تعداد را انتخاب کنید:",
  addedToCartSuccess: (title: string, qty: number) => `✅ ${qty} عدد «${title}» به سبد خرید اضافه شد.`,
  
  // Orders
  myOrdersHeader: () => "📦 سفارش‌های شما:",
  noOrders: () => "شما هنوز سفارشی ثبت نکرده‌اید.",
  orderDetails: (id: number, status: string, total: number) =>
    `سفارش #${id}\nوضعیت: ${status}\nمبلغ: ${formatPrice(total)}`,
  
  // Cart Cleared
  cartCleared: () => "🗑️ سبد خرید شما خالی شد.",

  // Pre-checkout Info Gathering
  checkoutInfoRequired: () => "📋 قبل از ثبت سفارش، لطفاً اطلاعات زیر را تکمیل کنید:",
  askPhone: () => "📱 لطفاً شماره تماس خود را ارسال کنید.\n\nمی‌توانید از دکمه «ارسال شماره تماس» استفاده کنید یا با «تایپ دستی شماره» شماره را وارد کنید:",
  askPhoneButton: () => "📱 ارسال شماره تماس",
  askPhoneManualButton: () => "✏️ تایپ دستی شماره",
  askPhoneManualPrompt: () => "📱 لطفاً شماره تلفن خود را به صورت کامل وارد کنید (مثلاً: 09123456789):",
  phoneReceived: () => "✅ شماره تماس ثبت شد.",
  invalidPhone: () => "❌ شماره تلفن نامعتبر است. لطفاً یک شماره معتبر با فرمت 09123456789 وارد کنید:",
  askLocation: () => "📍 اگر می‌خواهید ارسال دقیق‌تر انجام شود، موقعیت مکانی تحویل را ارسال کنید.\n\nمی‌توانید موقعیت فعلی خود را بفرستید یا از منوی پیوست تلگرام نقطه مورد نظر را روی نقشه انتخاب کنید.",
  askLocationButton: () => "📍 ارسال موقعیت فعلی",
  locationReceived: () => "✅ موقعیت مکانی ثبت شد.",
  invalidLocation: () => "❌ مکان باید به صورت موقعیت مکانی (Location) ارسال شود.\n\nاز دکمه «📍 ارسال موقعیت فعلی» استفاده کنید یا از منوی پیوست (📎) یک نقطه روی نقشه انتخاب کنید.",
  askAddress: () => "🏠 لطفاً آدرس کامل تحویل را ارسال کنید:\n\nنام خیابان، پلاک، واحد و توضیح لازم برای پیک را بنویسید.",
  addressReceived: () => "✅ آدرس ثبت شد.",
  infoComplete: () => "✅ اطلاعات کامل شد. در حال ثبت سفارش...",
  skipInfo: () => "رد کردن",
  cancelCheckout: () => "❌ ثبت سفارش لغو شد.",
  actionCancelled: () => "✅ عملیات لغو شد.",

  // Order Status Updates
  orderApproved: (orderId: number) => `✅ سفارش #${orderId} تأیید شد. اطلاعات پرداخت برای شما ارسال می‌شود.`,
  orderRejected: (orderId: number, reason?: string) => 
    `❌ سفارش #${orderId} تأیید نشد.${reason ? `\n\nعلت: ${reason}` : ''}`,

  // Receipt Submission
  sendReceiptPrompt: () => "📸 لطفاً عکس واضح رسید پرداخت را ارسال کنید:",
  receiptReceived: () => "✅ رسید دریافت شد. پس از بررسی مدیر، وضعیت سفارش به شما اعلام می‌شود.",
  receiptApproved: (orderId: number, etaText?: string) =>
    `✅ رسید سفارش #${orderId} تأیید شد.${etaText ? `\n\n${etaText}` : ''}\n\n🙏 تا زمان تحویل سفارش، پیام‌های ربات را دنبال کنید؛ هماهنگی‌های ارسال از همین‌جا انجام می‌شود.`,
  receiptRejected: (orderId: number, reason?: string) => 
    `❌ رسید سفارش #${orderId} تأیید نشد.${reason ? `\n\nعلت: ${reason}` : ''}\n\nلطفاً یک عکس جدید از رسید ارسال کنید.`,
  noActiveOrderForReceipt: () => "❌ سفارشی که منتظر رسید باشد ندارید.",

  // Support / Chat
  supportTitle: () => "💬 پشتیبانی",
  supportIntro: () => "شما وارد بخش پشتیبانی شدید. پیام خود را ارسال کنید تا تیم فروشگاه پاسخ دهد.",
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
  welcome: (pendingCount: number) => `سلام مدیر محترم. سفارش‌های در انتظار بررسی: ${pendingCount}`,

  // Pending Orders
  noPendingOrders: () => "هیچ سفارشی برای بررسی وجود ندارد.",
  pendingOrdersHeader: () => "سفارش‌های در انتظار بررسی:",
  pendingOrderLine: (orderId: number, userId: number, grandTotal: number) =>
    `#${orderId} – کاربر ${userId} – مبلغ ${formatPrice(grandTotal)}`,

  // Approve Order
  approveUsage: () => "فرمت: /approve_order <شماره سفارش>",
  orderNotFound: () => "سفارش پیدا نشد یا در وضعیت بررسی نیست.",
  orderApproved: (orderId: number) => `سفارش #${orderId} تأیید شد و وارد مرحله پرداخت شد.`,

  // Reject Order
  rejectUsage: () => "فرمت: /reject_order <شماره سفارش>",
  orderRejected: (orderId: number) => `سفارش #${orderId} رد شد.`,

  // Help
  helpMessage: () => `
👔 *راهنمای مدیر - فروشگاه ایرانی*

برای کار با ربات مدیریتی، از دکمه‌های منو استفاده کنید.
*مهم‌ترین بخش‌ها:*

- «رسیدها»: بررسی و تأیید/رد رسیدهای پرداخت کاربران
- «سفارش‌ها»: مشاهده سفارش‌ها و پیگیری وضعیت‌های مهم
- «محصولات»: افزودن، ویرایش و غیرفعال‌سازی محصول
- «کاربران»: مدیریت تخفیف، دعوت‌نامه و وضعیت دسترسی کاربران
- «پشتیبانی»: صندوق پیام‌های کاربران و پاسخ‌دهی
`.trim(),

  // UI Messages
  mainMenuTitle: () => "👔 *داشبورد مدیریت*\n\nکارهای روزانه از «رسیدها» و «سفارش‌ها» شروع می‌شود.",
  
  // Products Management
  productsMenuTitle: () => "📦 *مدیریت محصولات*",
  productListTitle: () => "📦 *لیست محصولات*",
  noProducts: () => "هیچ محصولی یافت نشد.",
  productCreated: (title: string) => `✅ محصول «${title}» با موفقیت ایجاد شد.`,
  productUpdated: () => "✅ محصول با موفقیت به‌روزرسانی شد.",
  productDeleted: () => "✅ محصول غیرفعال شد.",
  enterProductTitle: () => "عنوان محصول را وارد کنید.\n\nبرای لغو از دکمه «انصراف» استفاده کنید یا /cancel را ارسال کنید.",
  enterProductDescription: () => "توضیحات محصول را وارد کنید.\n\nاگر توضیح لازم نیست، دکمه «رد کردن توضیحات» را بزنید.",
  enterProductPrice: () => "قیمت محصول را فقط با عدد وارد کنید.",
  enterProductStock: () => "موجودی اولیه را فقط با عدد وارد کنید.\n\nاگر موجودی نامحدود یا نامشخص است، دکمه مربوط را بزنید.",
  sendProductImage: () => "عکس محصول را ارسال کنید.\n\nاگر تصویر ندارید، دکمه «بدون تصویر» را بزنید.",
  invalidNumber: () => "❌ لطفاً یک عدد معتبر وارد کنید.",

  // User Management
  usersMenuTitle: () => "👥 *مدیریت کاربران*",
  userListTitle: () => "👥 *لیست کاربران*",
  noUsers: () => "هیچ کاربری یافت نشد.",
  userDetails: (id: number, username: string | null, isActive: boolean, orderCount: number, canCreateReferral: boolean, effectiveScore: number, hasOverride: boolean, discountLabel: string, maxReferralCodes?: number) =>
    `*کاربر #${id}*\n\nنام کاربری: ${escapeMarkdown(username) || '—'}\nوضعیت: ${isActive ? '✅ فعال' : '🚫 مسدود'}\nمجوز ساخت کد یک‌بارمصرف: ${canCreateReferral ? '✅ دارد' : '❌ ندارد'}\n🔢 سقف ساخت کد: ${maxReferralCodes ?? 3}\n⭐ امتیاز وفاداری: ${effectiveScore}/10${hasOverride ? ' (تنظیم‌شده توسط مدیر)' : ''}\n🎯 تخفیف کاربر: ${discountLabel}\nتعداد سفارش: ${orderCount}`,
  userBlocked: (username: string | null) => `🚫 کاربر ${username || 'نامشخص'} مسدود شد.`,
  userUnblocked: (username: string | null) => `✅ کاربر ${username || 'نامشخص'} رفع مسدود شد.`,
  userReferralGranted: (username: string | null) => `🔑 مجوز ساخت کد معرفی یک‌بارمصرف برای ${username || 'کاربر'} فعال شد.`,
  userReferralRevoked: (username: string | null) => `🔒 مجوز ساخت کد معرفی یک‌بارمصرف از ${username || 'کاربر'} گرفته شد.`,
  userDeleted: (username: string | null) => `🗑️ کاربر ${username || 'نامشخص'} حذف شد.`,
  userDeleteConfirm: (username: string | null) => `⚠️ آیا از حذف کاربر ${username || 'نامشخص'} مطمئن هستید؟ این عمل غیرقابل بازگشت است.`,
  enterSearchQuery: () => "نام کاربری یا شناسه تلگرام را وارد کنید:\n\nبرای لغو، /cancel را ارسال کنید.",
  enterUserScore: () => "امتیاز جدید (۰ تا ۱۰) را وارد کنید:\n\nبرای لغو، /cancel را ارسال کنید.",
  userScoreUpdated: (score: number) => `⭐ امتیاز کاربر به ${score} تغییر یافت.`,

  // Loyalty Score
  enterReferralScore: () => "⭐ امتیاز وفاداری کاربری را انتخاب کنید که این دعوت‌نامه یک‌بارمصرف را استفاده می‌کند.\n\nهر دعوت‌نامه فقط برای یک ورود معتبر است و بعد از استفاده منقضی می‌شود.",
  invalidScore: () => "❌ امتیاز باید عددی بین ۰ تا ۱۰ باشد.",

  // User Discount
  enterUserDiscount: (current = "ندارد") =>
    `🎯 تخفیف فعلی کاربر: ${current}\n\n` +
    `برای تخفیف‌های رایج از دکمه‌ها استفاده کنید.\n` +
    `برای مقدار دلخواه، درصد را با علامت درصد وارد کنید؛ مثال: 15%\n` +
    `برای مبلغ ثابت، عدد مبلغ را وارد کنید؛ مثال: 50000\n` +
    `برای حذف تخفیف هم می‌توانید 0 را ارسال کنید.`,
  invalidUserDiscount: () => "❌ مقدار تخفیف معتبر نیست. مثال‌های معتبر: 15% یا 50000 یا 0",
  userDiscountUpdated: (label: string) => `✅ تخفیف کاربر به «${label}» تغییر کرد.`,
  userDiscountRemoved: () => "✅ تخفیف کاربر حذف شد.",

  // User Max Referral Codes
  enterMaxReferralCodes: (current: number) => `🔢 سقف تعداد کدهای معرفی یک‌بارمصرف این کاربر را وارد کنید (۰ تا ۱۰۰).\nمقدار فعلی: ${current}\n\nبرای لغو، /cancel را ارسال کنید.`,
  invalidMaxReferralCodes: () => "❌ لطفاً عددی بین ۰ تا ۱۰۰ وارد کنید.",
  userMaxCodesUpdated: (max: number) => `✅ سقف ساخت کدهای معرفی یک‌بارمصرف به ${max} تنظیم شد.`,

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
  enterCourierTgId: () => "شناسه عددی تلگرام پیک را وارد کنید.\n\nاین عدد با نام کاربری فرق دارد؛ پیک باید قبلاً ربات پیک را باز کرده باشد تا بتواند پیام‌های مأموریت را دریافت کند.",
  invalidTgId: () => "❌ شناسه تلگرام باید یک عدد معتبر باشد.",

  // Referral Management
  referralsMenuTitle: () => "🔗 *مدیریت کدهای معرفی*",
  referralListTitle: () => "🔗 *کدهای معرفی یک‌بارمصرف*",
  noReferralCodes: () => "هیچ کد معرفی یافت نشد.",
  referralCodeCreated: (code: string) => `✅ کد معرفی یک‌بارمصرف ایجاد شد: \`${code}\``,
  referralCodeDeactivated: () => "✅ کد معرفی منقضی شد و دیگر قابل استفاده نیست.",
  enterReferralMaxUses: () => "کدهای معرفی فقط یک بار قابل استفاده هستند.",

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
    `✅ کدهای استفاده‌نشده: ${activeCodes}\n` +
    `📊 کدهای استفاده‌شده: ${totalUses}\n` +
    `👥 کاربران معرفی‌شده: ${referredUsers}\n` +
    `📈 میانگین مصرف کدها: ${avgUses}\n` +
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
  enterRejectReason: () => "علت رد رسید را انتخاب کنید یا دلیل دلخواه بنویسید. این متن برای مشتری ارسال می‌شود.",
  enterEtaMessage: () => "⏰ پیام زمان تقریبی تحویل را انتخاب کنید یا متن دلخواه بنویسید.\n\nاین پیام پس از تأیید رسید برای مشتری ارسال می‌شود.",

  // Support / Chat
  supportInboxTitle: () => "💬 *صندوق پشتیبانی*",
  noSupportConversations: () => "هیچ گفتگوی بازِ پشتیبانی وجود ندارد.",
  supportConversationTitle: (conversationId: number) => `💬 *گفتگو #${conversationId}*`,
  supportAskReply: () => "✍️ متن پاسخ را بنویسید.\n\nقبل از ارسال به مشتری، پیش‌نمایش و دکمه تأیید نمایش داده می‌شود.",
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
  settingsImageAsk: () => "🖼️ تصویر پرداخت را ارسال کنید (این تصویر همراه اطلاعات پرداخت برای کاربر ارسال می‌شود):",
  settingsExpiryAsk: () => "⏳ مهلت پرداخت را به دقیقه وارد کنید (مثلاً 60).\n\nقبل از ذخیره، پیش‌نمایش و دکمه تأیید نمایش داده می‌شود.",
  settingsExpiryUpdated: (minutes: number) => `✅ مهلت پرداخت به ${minutes} دقیقه تغییر یافت.`,
  settingsExpiryInvalid: () => "❌ لطفاً یک عدد معتبر (بزرگتر از صفر) وارد کنید.",
  // Card Number Settings
  settingsCardAsk: () => "💳 شماره کارت ۱۶ رقمی را وارد کنید (بدون فاصله یا خط تیره).\n\nقبل از ذخیره، پیش‌نمایش و دکمه تأیید نمایش داده می‌شود.\nبرای پاک کردن شماره کارت، /delete را ارسال کنید.",
  settingsCardUpdated: (cardNumber: string) => `✅ شماره کارت به \`${cardNumber}\` تغییر یافت.`,
  settingsCardDeleted: () => "✅ شماره کارت حذف شد. پیام پرداخت بدون شماره کارت ارسال می‌شود.",

  // Courier Message Settings
  settingsDeliveryMsgAsk: () => "📝 پیام ارسالی به کاربر هنگام «در مسیر ارسال» شدن را وارد کنید.\n\nقبل از ذخیره، پیش‌نمایش و دکمه تأیید نمایش داده می‌شود.\nبرای پاک کردن پیام سفارشی، /delete را ارسال کنید.",
  settingsDeliveryMsgUpdated: (msg: string) => `✅ پیام ارسال به‌روزرسانی شد:\n\n${msg}`,
  settingsDeliveryMsgDeleted: () => "✅ پیام سفارشی حذف شد. فقط وضعیت استاندارد ارسال می‌شود.",
  settingsCardInvalid: () => "❌ شماره کارت باید ۱۶ رقمی و فقط شامل اعداد باشد. دوباره تلاش کنید:",
};

export const CourierTexts = {
  notAuthorized: () => "شما به عنوان پیک مجاز نیستید.",
  dashboardTitle: () => "🚚 مأموریت‌های پیک",
  deliveriesTitle: () => "🚚 مأموریت‌های فعال شما",
  noDeliveries: () => "فعلاً مأموریت فعالی برای شما ثبت نشده است.",
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
  askFailureReason: () => "لطفاً علت ناموفق بودن تحویل را ارسال کنید.",
  statusUpdated: (status: string) => `✅ وضعیت ارسال به «${status}» تغییر کرد.`,
  failureReasonSaved: () => "✅ علت تحویل ناموفق ثبت شد.",
  invalidDelivery: () => "این ارسال معتبر نیست.",
  notFound: () => "موردی پیدا نشد.",
  updated: () => "✅ ثبت شد.",
  askFailureReasonEmpty: () => "لطفاً علت تحویل ناموفق را ارسال کنید.",
  statusAssigned: () => "اختصاص داده‌شده",
  statusPickedUp: () => "تحویل گرفته شد",
  statusOutForDelivery: () => "در مسیر ارسال",
  statusDelivered: () => "تحویل داده شد",
  statusFailed: () => "تحویل ناموفق",
};

// ===========================================
// PAYMENT TEXTS (sent to the customer during checkout)
// ===========================================

export const ChannelTexts = {
  paymentMessage: (orderId: number, grandTotal: number, cardNumber?: string, currency?: string) =>
    `💳 *پرداخت سفارش #${orderId}*\n\n` +
    `مبلغ قابل پرداخت: *${formatPrice(grandTotal)}${currency && currency !== "IRR" ? ` ${currency}` : ""}*\n\n` +
    (cardNumber ? `🏦 شماره کارت: \`${cardNumber}\`\n\n` : '') +
    `لطفاً مبلغ فوق را به شماره کارت ذکر شده واریز کنید ` +
    `و سپس عکس رسید را در همین ربات ارسال نمایید.\n\n` +
    `⏳ این پیام پس از اتمام مهلت پرداخت حذف خواهد شد.\n\n` +
    `🙏 تا زمان تحویل سفارش، پیام‌های ربات را دنبال کنید؛ هماهنگی‌های ارسال از همین‌جا انجام می‌شود.`,
};
