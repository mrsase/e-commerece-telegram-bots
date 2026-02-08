# Amoosh Telegram Bots

A dual-bot e-commerce system for Telegram built with TypeScript, Fastify, Prisma, and grammY.

## Table of Contents

- [Overview](#overview)
- [System Architecture](#system-architecture)
- [Requirements](#requirements)
- [Quick Start](#quick-start)
- [Environment Variables](#environment-variables)
- [Database Schema](#database-schema)
- [Client Bot](#client-bot)
- [Manager Bot](#manager-bot)
- [Order Workflow](#order-workflow)
- [Background Jobs](#background-jobs)
- [HTTP Endpoints](#http-endpoints)
- [Development](#development)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)

---

## Overview

This project implements two Telegram bots for an e-commerce platform:

1. **Client Bot** - Customer-facing bot for browsing products, managing shopping cart, and placing orders
2. **Manager Bot** - Admin bot for reviewing and approving/rejecting customer orders

### Key Features

- **Product Catalog**: Browse and view available products
- **Shopping Cart**: Add/remove items, view cart contents
- **Order Management**: Submit orders for manager approval
- **Discount System**: Support for percentage and fixed discounts, auto-rules, usage limits
- **Invite Links**: Auto-generate Telegram channel invite links for approved orders
- **Receipt Upload**: Customers can upload payment receipts
- **Referral System**: Built-in referral code tracking

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Telegram API                              │
└─────────────────────────┬───────────────────────────────────────┘
                          │
          ┌───────────────┴───────────────┐
          ▼                               ▼
┌─────────────────┐             ┌─────────────────┐
│   Client Bot    │             │  Manager Bot    │
│   (Customers)   │             │   (Admins)      │
└────────┬────────┘             └────────┬────────┘
         │                               │
         └───────────────┬───────────────┘
                         ▼
              ┌─────────────────────┐
              │   Fastify Server    │
              │   (HTTP + Webhooks) │
              └──────────┬──────────┘
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│   Prisma    │  │   BullMQ    │  │   Redis     │
│   (SQLite/  │  │  (Workers)  │  │  (Queue)    │
│  PostgreSQL)│  │  Optional   │  │  Optional   │
└─────────────┘  └─────────────┘  └─────────────┘
```

---

## Requirements

- **Node.js** 20.x or higher
- **npm** 10.x or higher
- **SQLite** (development) or **PostgreSQL** (production)
- **Redis** (optional, for background job queues)

---

## Quick Start

### 1. Install Dependencies

```bash
cd apps/telegram-bots
npm install
```

### 2. Configure Environment

Create a `.env` file:

```env
# Database
DATABASE_URL=file:./prisma/dev.db

# Bot Tokens (get from @BotFather on Telegram)
CLIENT_BOT_TOKEN=your_client_bot_token
MANAGER_BOT_TOKEN=your_manager_bot_token

# Server
PORT=3000
NODE_ENV=development

# Update Mode (auto, polling, or webhook)
UPDATES_MODE=polling
```

### 3. Initialize Database

```bash
npx prisma db push
```

### 4. Seed Database (Add Manager)

Before using the manager bot, you need to add yourself as a manager:

```bash
# TODO: Run the seed script once implemented
npm run db:seed
```

Or manually insert via Prisma Studio:

```bash
npx prisma studio
```

Then add a record to the `Manager` table:
- `tgUserId`: Your Telegram user ID (get it from @userinfobot)
- `role`: `ADMIN`
- `isActive`: `true`

### 5. Start Development Server

```bash
npm run dev
```

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | - | Prisma connection string |
| `CLIENT_BOT_TOKEN` | Yes | - | Telegram bot token for client bot |
| `MANAGER_BOT_TOKEN` | Yes | - | Telegram bot token for manager bot |
| `COURIER_BOT_TOKEN` | Yes | - | Telegram bot token for courier bot |
| `ADMIN_TG_USER_ID` | Yes | - | Telegram user ID for the admin manager (seed) |
| `COURIER_TG_USER_ID` | No | - | Telegram user ID for the courier (seed) |
| `PORT` | No | `3000` | HTTP server port |
| `NODE_ENV` | No | `development` | Environment mode |
| `UPDATES_MODE` | No | `auto` | `auto`, `polling`, or `webhook` |
| `ENABLE_QUEUES` | No | `false` | Enable Redis/BullMQ workers |
| `REDIS_URL` | If queues | - | Redis connection string |
| `CHECKOUT_CHANNEL_ID` | If queues | - | Telegram channel for invite links |

### Getting Bot Tokens

1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot` and follow the prompts
3. Create three bots: one for clients, one for managers, one for couriers
4. Copy the tokens to your `.env` file

### Getting Your Telegram User ID

To use the manager bot, you need your Telegram user ID:

1. Message [@userinfobot](https://t.me/userinfobot) on Telegram
2. It will reply with your user ID (a number like `123456789`)

---

## Database Schema

### Core Models

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│     User     │────▶│     Cart     │────▶│   CartItem   │
│              │     │              │     │              │
│ - tgUserId   │     │ - state      │     │ - qty        │
│ - username   │     │ - userId     │     │ - unitPrice  │
│ - referral   │     │              │     │              │
└──────────────┘     └──────────────┘     └──────────────┘
       │                    │
       │                    ▼
       │             ┌──────────────┐     ┌──────────────┐
       │             │    Order     │────▶│  OrderItem   │
       │             │              │     │              │
       │             │ - status     │     │ - qty        │
       │             │ - subtotal   │     │ - lineTotal  │
       │             │ - grandTotal │     │              │
       │             └──────────────┘     └──────────────┘
       │                    │
       ▼                    ▼
┌──────────────┐     ┌──────────────┐
│   Manager    │     │  OrderEvent  │
│              │     │              │
│ - role       │     │ - eventType  │
│ - isActive   │     │ - actorType  │
└──────────────┘     └──────────────┘
```

### Key Enums

**CartState**: `ACTIVE` | `SUBMITTED` | `EXPIRED`

**OrderStatus**:
- `AWAITING_MANAGER_APPROVAL` - Order submitted, waiting for review
- `APPROVED` - Manager approved the order
- `INVITE_SENT` - Invite link sent to customer
- `AWAITING_RECEIPT` - Waiting for payment receipt
- `COMPLETED` - Order completed
- `CANCELLED` - Order rejected/cancelled

**ManagerRole**: `STAFF` | `ADMIN`

---

## Client Bot

The client bot serves customers who want to browse products and place orders.

### Commands

| Command | Usage | Description |
|---------|-------|-------------|
| `/start` | `/start` | Register and welcome message |
| `/products` | `/products` | View available products (up to 10) |
| `/add` | `/add <productId> <qty>` | Add item to cart |
| `/remove` | `/remove <productId>` | Remove item from cart |
| `/cart` | `/cart` | View cart contents and subtotal |
| `/checkout` | `/checkout` | Submit order for approval |

### Example Flow

```
User: /start
Bot: Welcome to the Amoosh shop (TS bot skeleton).

User: /products
Bot: Available products:
     Widget A - 10000 IRR
     Widget B - 15000 IRR

User: /add 1 2
Bot: Added to cart: Widget A x 2.

User: /cart
Bot: Your cart:
     Widget A x 2 = 20000 IRR
     
     Subtotal: 20000

User: /checkout
Bot: Order submitted! ID: 1, total: 20000.
```

### How It Works

1. **Registration**: On `/start`, the bot creates/updates the user record with their Telegram info
2. **Referral Code**: Each user gets a unique referral code (`TSU_<telegram_id>`)
3. **Cart Management**: Users have one active cart at a time; adding items creates or updates cart
4. **Price Snapshot**: Cart items store the price at time of addition (protects against price changes)
5. **Checkout**: Creates an order, links it to the cart, marks cart as SUBMITTED

---

## Manager Bot

The manager bot is for administrators to review and process customer orders.

### Authorization

Only users in the `Manager` table with `isActive: true` can use this bot. Others receive:
> "You are not authorized to use this bot."

### Commands

| Command | Usage | Description |
|---------|-------|-------------|
| `/start` | `/start` | Show pending orders count |
| `/pending_orders` | `/pending_orders` | List up to 10 pending orders |
| `/approve_order` | `/approve_order <orderId>` | Approve an order |
| `/reject_order` | `/reject_order <orderId>` | Reject an order |

### Example Flow

```
Manager: /start
Bot: Hello, manager. Pending orders: 3.

Manager: /pending_orders
Bot: Pending orders:
     #1 – user 5 – total 20000
     #2 – user 8 – total 15000
     #3 – user 5 – total 35000

Manager: /approve_order 1
Bot: Order #1 approved.

Manager: /reject_order 2
Bot: Order #2 rejected.
```

### How It Works

1. **Authentication**: Each command checks if the sender is an active manager
2. **Order Review**: Managers see order ID, user ID, and total amount
3. **Approval**: Changes status to `APPROVED`, creates an `order_approved` event
4. **Rejection**: Changes status to `CANCELLED`, creates an `order_rejected` event
5. **Event Tracking**: All actions are logged with actor type and ID

---

## Order Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│                        ORDER LIFECYCLE                           │
└─────────────────────────────────────────────────────────────────┘

Customer                          System                        Manager
   │                                │                              │
   │ /checkout                      │                              │
   ├───────────────────────────────▶│                              │
   │                                │ Create Order                 │
   │                                │ Status: AWAITING_APPROVAL    │
   │                                │                              │
   │                                │◀─────────────────────────────┤
   │                                │     /pending_orders          │
   │                                │                              │
   │                                │     /approve_order <id>      │
   │                                │◀─────────────────────────────┤
   │                                │                              │
   │                                │ Status: APPROVED             │
   │                                │                              │
   │                                │ [If queues enabled]          │
   │                                │ Worker creates invite link   │
   │                                │ Status: INVITE_SENT          │
   │                                │                              │
   │◀───────────────────────────────│                              │
   │ "Your order approved!          │                              │
   │  Join: t.me/+abc123"           │                              │
   │                                │                              │
```

---

## Background Jobs

Background jobs are **optional** and require Redis. They handle:

### 1. Send Invites Worker (`send_invites`)

- **Frequency**: Every 60 seconds
- **Purpose**: Find approved orders without invite links, create invite, notify customer
- **Process**:
  1. Query orders with `status: APPROVED` and `inviteLink: null`
  2. Create Telegram channel invite link
  3. Update order with invite link and status `INVITE_SENT`
  4. Send message to customer with the invite link

### 2. Cleanup Carts Worker (`cleanup_carts`)

- **Frequency**: Every hour
- **Purpose**: Expire abandoned shopping carts
- **Process**:
  1. Find carts with `state: ACTIVE` and `updatedAt` older than 24 hours
  2. Update state to `EXPIRED`

### Enabling Background Jobs

```env
ENABLE_QUEUES=true
REDIS_URL=redis://localhost:6379
CHECKOUT_CHANNEL_ID=@your_checkout_channel
```

---

## HTTP Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check (`{ "status": "ok" }`) |
| `POST` | `/webhook/client` | Telegram webhook for client bot |
| `POST` | `/webhook/manager` | Telegram webhook for manager bot |

### Setting Up Webhooks

For production, configure Telegram to send updates to your server:

```bash
# Client bot webhook
curl "https://api.telegram.org/bot<CLIENT_TOKEN>/setWebhook" \
  -d "url=https://your-domain.com/webhook/client"

# Manager bot webhook
curl "https://api.telegram.org/bot<MANAGER_TOKEN>/setWebhook" \
  -d "url=https://your-domain.com/webhook/manager"
```

---

## Development

### Project Structure

```
src/
├── bots/
│   ├── client/
│   │   ├── client-bot-handlers.ts      # Client bot commands
│   │   └── client-bot-handlers.test.ts
│   └── manager/
│       ├── manager-bot-handlers.ts     # Manager bot commands
│       └── manager-bot-handlers.test.ts
├── config/
│   └── app-config.ts                   # Environment config
├── infra/
│   ├── db/                             # Database utilities
│   ├── http/
│   │   └── server.ts                   # Fastify server
│   ├── queue/
│   │   └── bullmq.ts                   # Queue setup
│   └── telegram/
│       ├── bots.ts                     # Bot creation
│       └── webhooks.ts                 # Webhook handlers
├── jobs/
│   ├── send-invites.worker.ts          # Invite worker
│   └── cleanup-carts.worker.ts         # Cart cleanup worker
├── services/
│   ├── order-service.ts                # Order creation logic
│   ├── discount-service.ts             # Discount calculations
│   └── invite-service.ts               # Invite link creation
└── main.ts                             # Application entry point
```

### NPM Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server with hot reload |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled production build |
| `npm test` | Run all tests |
| `npm run test:coverage` | Run tests with coverage report |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run TypeScript type checking |

### Running Tests

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test file
npx vitest run src/bots/client/client-bot-handlers.test.ts
```

### Customizing Bot Texts

All user-facing messages are centralized in `src/i18n/texts.ts`. To customize:

1. Open `src/i18n/texts.ts`
2. Find the text you want to modify
3. Edit the return value of the function

**Example:**
```typescript
// Before
welcome: () => "Welcome to the Amoosh shop! Use /help to see available commands.",

// After
welcome: () => "Welcome to our store! Type /help for assistance.",
```

**Text categories:**
- `ClientTexts` - Customer-facing bot messages
- `ManagerTexts` - Manager bot messages
- `NotificationTexts` - Background worker notifications

### Adding New Commands

1. **Define the command** in `src/config/bot-commands.ts`:
```typescript
export const CLIENT_BOT_COMMANDS: BotCommand[] = [
  // ... existing commands
  { command: "mycommand", description: "My new command" },
];
```

2. **Add the handler** in the appropriate bot handlers file:
```typescript
bot.command("mycommand", async (ctx) => {
  const user = await ensureUser(ctx, prisma);
  // Your logic here
  await ctx.reply(ClientTexts.myCommandResponse());
});
```

3. **Add texts** to `src/i18n/texts.ts`:
```typescript
export const ClientTexts = {
  // ... existing texts
  myCommandResponse: () => "Response for my command",
};
```

4. **Add tests** in the corresponding test file.

---

## Deployment

### Production Checklist

1. ✅ Set `NODE_ENV=production`
2. ✅ Use PostgreSQL instead of SQLite
3. ✅ Set `UPDATES_MODE=webhook`
4. ✅ Configure HTTPS for webhook endpoints
5. ✅ Set up Redis if using background jobs
6. ✅ Add manager(s) to database
7. ✅ Register webhooks with Telegram API

### PM2 Configuration

Create `ecosystem.config.cjs`:

```js
module.exports = {
  apps: [
    {
      name: "amoosh-telegram-bots",
      script: "./dist/main.js",
      cwd: "/path/to/apps/telegram-bots",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: "3000",
        DATABASE_URL: "postgresql://user:pass@localhost:5432/amoosh",
        CLIENT_BOT_TOKEN: "<token>",
        MANAGER_BOT_TOKEN: "<token>",
        UPDATES_MODE: "webhook",
        ENABLE_QUEUES: "true",
        REDIS_URL: "redis://localhost:6379",
        CHECKOUT_CHANNEL_ID: "@your_channel",
      },
    },
  ],
};
```

Deploy:

```bash
npm run build
pm2 start ecosystem.config.cjs
pm2 save
```

---

## Troubleshooting

### Bot Not Responding

1. **Check bot token**: Ensure tokens are correct in `.env`
2. **Check updates mode**: In development, use `UPDATES_MODE=polling`
3. **Check logs**: Look for errors in console output
4. **Verify webhook**: If using webhooks, ensure URL is accessible and HTTPS

### Manager Bot Says "Not Authorized"

1. **Check Manager table**: Ensure your Telegram user ID is in the database
2. **Verify user ID**: Use @userinfobot to confirm your ID
3. **Check isActive**: Manager record must have `isActive: true`

### Orders Not Getting Invite Links

1. **Enable queues**: Set `ENABLE_QUEUES=true`
2. **Check Redis**: Ensure Redis is running and `REDIS_URL` is correct
3. **Check channel ID**: `CHECKOUT_CHANNEL_ID` must be a valid channel
4. **Bot permissions**: Bot must be admin in the channel

### Database Errors

1. **Run migrations**: `npx prisma db push`
2. **Check connection**: Verify `DATABASE_URL` is correct
3. **Generate client**: `npx prisma generate`

### Test Failures

1. **Database state**: Tests share the database; run them in isolation
2. **Missing env**: Ensure `DATABASE_URL` is set for tests
3. **Skipped tests**: Some tests are skipped due to shared state issues

---

## License

Private - All rights reserved
