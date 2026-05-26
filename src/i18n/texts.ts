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
  welcomeNewUser: () => "👋 سلام! برای استفاده از فروشگاه، لطفاً یک کد معرفی معتبر وارد کنید:",
  invalidReferralCode: () => "❌ کد معرفی نامعتبر یا منقضی است. دوباره تلاش کنید:",
  referralCodeAccepted: () => "✅ کد معرفی تأیید شد! به فروشگاه آموز خوش آمدید.",
  userBlocked: () => "🚫 حساب شما مسدود شده است. لطفاً با پشتیبانی تماس بگیرید.",

  // Welcome & Start
  welcome: () => "به فروشگاه آموز خوش آمدید. از منوی زیر برای ادامه استفاده کنید.",
  welcomeBack: (name: string) => `سلام ${name}! 👋`,

  // Products
  noProductsAvailable: () => "فعلاً محصولی برای نمایش وجود ندارد.",
  productsHeader: () => "محصولات موجود:",
  productLine: (title: string, price: number, currency: string) =>
    `${title} - ${price} ${currency}`,

  // Cart
  cartEmpty: () => "سبد خرید شما خالی است.",
  cartHeader: () => "سبد خرید شما:",
  cartItemLine: (title: string, qty: number, lineTotal: number, currency: string) =>
    `${title} x ${qty} = ${lineTotal} ${currency}`,
  cartSubtotal: (subtotal: number) => `جمع: ${subtotal}`,

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
    `✅ سفارش شما ثبت شد! شماره: ${orderId}، مبلغ: ${grandTotal}.`,
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
  productDetails: (title: string, description: string | null, price: number, currency: string, stock: number | null) =>
    `*${escapeMarkdown(title)}*\n\n${escapeMarkdown(description) || 'بدون توضیحات'}\n\n💰 قیمت: ${price} ${currency}${stock !== null ? `\n📦 موجودی: ${stock}` : ''}`,
  selectQuantity: () => "تعداد را انتخاب کنید:",
  addedToCartSuccess: (title: string, qty: number) => `✅ ${qty} عدد ${title} به سبد خرید اضافه شد!`,
  
  // Orders
  myOrdersHeader: () => "📦 سفارش‌های شما:",
  noOrders: () => "شما هنوز سفارشی ثبت نکرده‌اید.",
  orderDetails: (id: number, status: string, total: number) =>
    `سفارش #${id}\nوضعیت: ${status}\nمبلغ: ${total}`,
  
  // Cart Cleared
  cartCleared: () => "🗑️ سبد خرید شما خالی شد.",

  // Pre-checkout Info Gathering
  checkoutInfoRequired: () => "📋 قبل از ثبت سفارش، لطفاً اطلاعات زیر را تکمیل کنید:",
  askPhone: () => "📱 لطفاً شماره تماس خود را ارسال کنید:",
  askPhoneButton: () => "📱 ارسال شماره تماس",
  phoneReceived: () => "✅ شماره تماس ثبت شد.",
  askLocation: () => "📍 لطفاً موقعیت مکانی خود را ارسال کنید:",
  askLocationButton: () => "📍 ارسال موقعیت مکانی",
  locationReceived: () => "✅ موقعیت مکانی ثبت شد.",
  askAddress: () => "🏠 لطفاً آدرس کامل را به صورت متن ارسال کنید:",
  addressReceived: () => "✅ آدرس ثبت شد.",
  infoComplete: () => "✅ اطلاعات کامل شد. در حال ثبت سفارش...",
  skipInfo: () => "رد کردن",
  cancelCheckout: () => "❌ ثبت سفارش لغو شد.",

  // Order Status Updates
  orderPendingApproval: () => "⏳ سفارش شما در حال بررسی توسط مدیر است. نتیجه به شما اطلاع داده می‌شود.",
  orderApproved: (orderId: number) => `✅ خبر خوب! سفارش #${orderId} تأیید شد.`,
  orderApprovedWithInvite: (orderId: number, inviteLink: string) => 
    `✅ سفارش #${orderId} تأیید شد.\n\n📢 برای اطلاعات پرداخت وارد کانال شوید:\n${inviteLink}\n\nپس از پرداخت، عکس رسید را همینجا ارسال کنید.`,
  orderRejected: (orderId: number, reason?: string) => 
    `❌ سفارش #${orderId} تأیید نشد.${reason ? `\n\nعلت: ${reason}` : ''}`,

  // Receipt Submission
  sendReceiptPrompt: () => "📸 لطفاً عکس رسید پرداخت را ارسال کنید:",
  receiptReceived: () => "✅ رسید دریافت شد. مدیر به‌زودی بررسی می‌کند.",
  receiptApproved: (orderId: number) => `✅ رسید سفارش #${orderId} تأیید شد. سفارش شما تکمیل شد.`,
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
🛒 *راهنمای فروشگاه آموز*

برای استفاده از ربات نیازی به تایپ کردن دستورها نیست؛
از دکمه‌های منو استفاده کنید.

*مراحل سفارش:*
1) از بخش «محصولات» کالاها را انتخاب کنید.
2) در «سبد خرید» اقلام را بررسی کنید.
3) «ثبت سفارش» را بزنید و اطلاعات تماس/آدرس را تکمیل کنید.
4) پس از تأیید مدیر، راهنمای پرداخت و ارسال رسید به شما اعلام می‌شود.

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
    `#${orderId} – کاربر ${userId} – مبلغ ${grandTotal}`,

  // Approve Order
  approveUsage: () => "فرمت: /approve_order <شماره سفارش>",
  orderNotFound: () => "سفارش پیدا نشد یا در وضعیت بررسی نیست.",
  orderApproved: (orderId: number) => `سفارش #${orderId} تأیید شد.`,

  // Reject Order
  rejectUsage: () => "فرمت: /reject_order <شماره سفارش>",
  orderRejected: (orderId: number) => `سفارش #${orderId} رد شد.`,

  // Help
  helpMessage: () => `
👔 *راهنمای مدیر - فروشگاه آموز*

برای کار با ربات مدیریتی، از دکمه‌های منو استفاده کنید.
*مهم‌ترین بخش‌ها:*

- «سفارش‌ها»: بررسی و تأیید/رد سفارش‌ها
- «رسیدها»: بررسی رسیدهای پرداخت
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
  userDetails: (id: number, username: string | null, isActive: boolean, orderCount: number, canCreateReferral: boolean, effectiveScore: number, hasOverride: boolean) =>
    `*کاربر #${id}*\n\nنام کاربری: ${escapeMarkdown(username) || '—'}\nوضعیت: ${isActive ? '✅ فعال' : '🚫 مسدود'}\nمجوز معرفی: ${canCreateReferral ? '✅ دارد' : '❌ ندارد'}\n⭐ امتیاز وفاداری: ${effectiveScore}/10${hasOverride ? ' (بازنویسی مدیر)' : ''}\nتعداد سفارش: ${orderCount}`,
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
  analyticsMenuTitle: () => "📊 *داشبورد آمار*",
  orderAnalytics: (total: number, pending: number, completed: number, revenue: number) =>
    `📦 *آمار سفارش‌ها*\n\nکل سفارش‌ها: ${total}\nدر انتظار: ${pending}\nتکمیل‌شده: ${completed}\nجمع فروش: ${revenue}`,
  userAnalytics: (total: number, active: number, newToday: number) =>
    `👥 *آمار کاربران*\n\nکل کاربران: ${total}\nکاربران فعال: ${active}\nکاربران امروز: ${newToday}`,
  productAnalytics: (total: number, active: number, lowStock: number) =>
    `📦 *آمار محصولات*\n\nکل محصولات: ${total}\nفعال: ${active}\nکم‌موجودی: ${lowStock}`,
  referralAnalytics: (totalCodes: number, totalUses: number, topReferrer: string | null) =>
    `🔗 *آمار معرفی*\n\nکل کدها: ${totalCodes}\nکل استفاده: ${totalUses}\nبهترین معرف: ${topReferrer || '—'}`,

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

  // Order Approval with Invite
  orderApprovedInviteSent: (orderId: number, userTgId: bigint) => 
    `✅ سفارش #${orderId} تأیید شد. لینک کانال برای کاربر ${userTgId} ارسال شد.`,
  inviteSendFailed: (orderId: number) => `⚠️ سفارش #${orderId} تأیید شد اما ارسال لینک کانال به کاربر ناموفق بود.`,

  // Support / Chat
  supportInboxTitle: () => "💬 *صندوق پشتیبانی*",
  noSupportConversations: () => "هیچ گفتگوی بازِ پشتیبانی وجود ندارد.",
  supportConversationTitle: (conversationId: number) => `💬 *گفتگو #${conversationId}*`,
  supportAskReply: () => "✍️ پاسخ را ارسال کنید:",
  supportReplySent: () => "✅ پاسخ ارسال شد.",
  supportConversationClosed: () => "✅ گفتگو بسته شد.",
  supportNewMessageNotification: (conversationId: number, fromLabel: string) =>
    `📩 پیام جدید پشتیبانی\nگفتگو #${conversationId}\nاز: ${fromLabel}`,
  envMissingCheckoutChannel: () => "امکان تأیید سفارش نیست: CHECKOUT_CHANNEL_ID تنظیم نشده است.",
  productNotFound: () => "محصول پیدا نشد.",
  productDeactivated: () => "محصول غیرفعال شد.",
  productActivated: () => "محصول فعال شد.",
  invalidDeliveryOrStatus: () => "مقدار نامعتبر است.",
  
  // User Info Display
  userContactInfo: (phone: string | null, address: string | null, lat: number | null, lng: number | null) =>
    `📋 *اطلاعات مشتری:*\nتلفن: ${escapeMarkdown(phone) || '—'}\nآدرس: ${escapeMarkdown(address) || '—'}${lat != null && lng != null ? `\n📍 موقعیت: ${lat.toFixed(6)}, ${lng.toFixed(6)}` : ''}`,

  // Settings
  settingsMenuTitle: (imageStatus: string, expiryMinutes: number, paymentMethod: "channel" | "direct" = "direct") =>
    `⚙️ *تنظیمات ربات*\n\n💳 روش پرداخت: ${paymentMethod === "channel" ? "📢 کانال" : "💳 مستقیم"}\n🖼️ تصویر پرداخت: ${imageStatus}\n⏳ مهلت پرداخت: ${expiryMinutes} دقیقه`,
  settingsImageUpdated: () => "✅ تصویر پرداخت با موفقیت به‌روزرسانی شد.",
  settingsImageDeleted: () => "✅ تصویر پرداخت حذف شد. از این پس فقط متن ارسال می‌شود.",
  settingsImageAsk: () => "🖼️ تصویر پرداخت را ارسال کنید (عکسی که در کانال نمایش داده می‌شود):",
  settingsExpiryAsk: () => "⏳ مهلت پرداخت را به دقیقه وارد کنید (مثلاً 60):",
  settingsExpiryUpdated: (minutes: number) => `✅ مهلت پرداخت به ${minutes} دقیقه تغییر یافت.`,
  settingsExpiryInvalid: () => "❌ لطفاً یک عدد معتبر (بزرگتر از صفر) وارد کنید.",
  settingsPayMethodToggled: (method: "channel" | "direct") =>
    method === "channel"
      ? "✅ روش پرداخت به \"\u06a9\u0627\u0646\u0627\u0644\" تغییر یافت. اطلاعات پرداخت در کانال پست می‌شود."
      : "✅ روش پرداخت به \"\u0645\u0633\u062a\u0642\u06cc\u0645\" تغییر یافت. اطلاعات پرداخت مستقیماً به کاربر ارسال می‌شود.",
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
// NOTIFICATION TEXTS (for workers)
// ===========================================

export const NotificationTexts = {
  // Invite Worker
  orderApprovedWithInvite: (orderId: number, inviteLink: string) =>
    `سفارش #${orderId} تأیید شد. برای پرداخت وارد کانال شوید: ${inviteLink}`,
};

// ===========================================
// CHANNEL TEXTS (posted inside the checkout channel)
// ===========================================

export const ChannelTexts = {
  paymentMessage: (orderId: number, grandTotal: number, currency: string) =>
    `💳 *پرداخت سفارش #${orderId}*\n\n` +
    `مبلغ قابل پرداخت: *${grandTotal.toLocaleString("fa-IR")} ${currency}*\n\n` +
    `لطفاً مبلغ فوق را به شماره کارت/حساب ذکر شده واریز کنید ` +
    `و سپس عکس رسید را در ربات فروشگاه ارسال نمایید.\n\n` +
    `⏳ این پیام پس از ثبت رسید یا اتمام مهلت پرداخت حذف خواهد شد.`,
};
