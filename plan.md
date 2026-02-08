# Amoosh Telegram Bots - Development Plan

## Phase 6: Interactive Button-Based UI (NEW)

### Overview
Replace command-based interaction with inline keyboard buttons for better UX.

### Client Bot Changes
1. **Main Menu** - Buttons for: Products, Cart, My Orders, My Referrals
2. **Product Browsing** - Grid of products with "Add to Cart" buttons
3. **Quantity Selection** - +/- buttons for quantity
4. **Cart View** - Items with remove/adjust buttons, checkout button
5. **Referral Gate** - Users must enter referral code to access bot

### Manager Bot Changes
1. **Main Menu** - Buttons for: Orders, Products, Users, Referrals, Analytics
2. **Order Management** - Approve/Reject buttons inline
3. **Product CRUD** - Add, Edit, Delete with button flows
4. **User Management** - View, Enable/Disable users

---

## Phase 7: Product Management (NEW)

### Features
1. **Add Product** - Title, description, price, stock, image
2. **Edit Product** - Modify any field
3. **Delete Product** - Soft delete (deactivate)
4. **Image Upload** - Store Telegram file_id for product images
5. **Stock Management** - Adjust stock levels

---

## Phase 8: User Management (NEW)

### Features
1. **List Users** - With pagination
2. **View User Details** - Orders, referrals, status
3. **Enable/Disable User** - Block access
4. **User Search** - By username or ID

---

## Phase 9: Referral System (NEW)

### Features
1. **Referral Gate** - New users must enter valid referral code
2. **User-Generated Codes** - Each user can create referral codes
3. **Manager Codes** - Managers can create unlimited codes
4. **Code Tracking** - Track who used which code
5. **Referral Stats** - Count of users referred

---

## Phase 10: Analytics Dashboard (NEW)

### Features
1. **Order Stats** - Total orders, pending, completed, revenue
2. **User Stats** - Total users, active users, new registrations
3. **Product Stats** - Best sellers, low stock alerts
4. **Referral Stats** - Most active referrers, code usage

---

## Original Phases (Completed)

## Project Analysis Summary

This project implements two Telegram bots for an e-commerce platform:

1. **Client Bot** - For customers to browse products, manage cart, and place orders
2. **Manager Bot** - For administrators to review and approve/reject orders

### Current Tech Stack
- **Runtime**: Node.js 20+
- **Language**: TypeScript
- **Web Framework**: Fastify
- **Bot Framework**: grammY
- **Database**: Prisma ORM with SQLite (dev) / PostgreSQL (prod)
- **Queue**: BullMQ with Redis (optional)
- **Testing**: Vitest

---

## Phase 1: Bug Fixes & Code Quality

### 1.1 Critical Bugs

| Issue | File | Description | Priority |
|-------|------|-------------|----------|
| `@prisma/client` in devDependencies | `package.json` | Should be in `dependencies` for production builds to work | **HIGH** |
| Missing error handling in webhooks | `src/infra/telegram/webhooks.ts` | Telegram API errors can crash the server | **HIGH** |
| No graceful shutdown for polling mode | `src/main.ts` | Bots in polling mode aren't stopped on shutdown | **MEDIUM** |

### 1.2 Potential Bugs / Code Smells

| Issue | File | Description |
|-------|------|-------------|
| Context type mismatch | `src/bots/client/client-bot-handlers.ts` | Custom `ClientContext` interface doesn't fully match grammY's real context |
| Unused imports | Various | Some imports may be unused after refactoring |
| Test database isolation | Test files | Tests share the same database, can cause flaky tests |

---

## Phase 2: Database Seeding

### 2.1 Requirements
- Create a seeding script to add initial manager(s)
- Support for seeding products for testing
- CLI command to run seeding

### 2.2 Implementation
1. Create `prisma/seed.ts` with seed data
2. Add seed script to `package.json`
3. Configure Prisma to use the seed script
4. Document the seeding process

### 2.3 Seed Data Structure
```typescript
// Manager seed (required for bot access)
{
  tgUserId: BigInt(process.env.ADMIN_TG_USER_ID),
  role: "ADMIN",
  isActive: true
}

// Sample products (optional, for testing)
[
  { title: "Product 1", price: 10000, currency: "IRR", stock: 100 },
  // ...
]
```

---

## Phase 3: Bot Command Menus

### 3.1 Requirements
- Both bots should register their commands with Telegram
- Commands should appear in the "/" menu in Telegram clients
- Commands should have descriptions

### 3.2 Client Bot Commands
| Command | Description |
|---------|-------------|
| `/start` | Start the bot and register |
| `/products` | View available products |
| `/add` | Add item to cart |
| `/remove` | Remove item from cart |
| `/cart` | View your cart |
| `/checkout` | Submit your order |
| `/help` | Show help message |

### 3.3 Manager Bot Commands
| Command | Description |
|---------|-------------|
| `/start` | Start the bot (shows pending count) |
| `/pending_orders` | List pending orders |
| `/approve_order` | Approve an order |
| `/reject_order` | Reject an order |
| `/help` | Show help message |

### 3.4 Implementation
1. Create command definitions in config
2. Call `bot.api.setMyCommands()` on startup
3. Add `/help` command to both bots

---

## Phase 4: Centralized Text Management (i18n)

### 4.1 Requirements
- All user-facing text should be in a centralized file
- Easy to modify without code changes
- Support for future multi-language support

### 4.2 File Structure
```
src/
  i18n/
    texts.ts           # Text constants and functions
    texts.schema.ts    # Type definitions for texts
```

### 4.3 Text Categories
1. **Client Bot Texts**
   - Welcome messages
   - Product listing
   - Cart messages
   - Order messages
   - Error messages

2. **Manager Bot Texts**
   - Welcome/greeting
   - Order listing
   - Approval/rejection confirmations
   - Error messages

3. **Notification Texts**
   - Order approval notification
   - Invite link message

### 4.4 Implementation
1. Create `src/i18n/texts.ts` with all texts
2. Update bot handlers to use text functions
3. Update worker texts
4. Document text customization

---

## Phase 5: Documentation Update

### 5.1 README Improvements
- Complete bot workflow documentation
- All available commands with examples
- Database schema explanation
- Deployment guide expansion
- Environment variables reference
- Troubleshooting guide

### 5.2 Architecture Documentation
- System diagram
- Data flow diagrams
- Bot interaction flows

---

## Implementation Order

```
Week 1:
├── Phase 1: Bug Fixes (Days 1-2)
├── Phase 2: Database Seeding (Days 2-3)
└── Phase 3: Command Menus (Days 4-5)

Week 2:
├── Phase 4: Centralized Texts (Days 1-3)
└── Phase 5: Documentation (Days 4-5)
```

---

## Files to Create/Modify

### New Files
- `prisma/seed.ts` - Database seeding script
- `src/i18n/texts.ts` - Centralized text management
- `src/i18n/index.ts` - Re-exports
- `checklist.md` - Task tracking

### Files to Modify
- `package.json` - Fix dependencies, add seed script
- `src/main.ts` - Add command registration, fix shutdown
- `src/bots/client/client-bot-handlers.ts` - Use texts, add help
- `src/bots/manager/manager-bot-handlers.ts` - Use texts, add help
- `src/infra/telegram/webhooks.ts` - Add error handling
- `src/jobs/send-invites.worker.ts` - Use texts
- `README.md` - Comprehensive documentation

---

## Success Criteria

1. ✅ All tests pass
2. ✅ No runtime errors on startup
3. ✅ Manager can access bot after seeding
4. ✅ Bot menus visible in Telegram
5. ✅ All texts modifiable from single file
6. ✅ README covers all functionality
