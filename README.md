# Amoosh Telegram Bots

A polling-only Telegram e-commerce service built with TypeScript, grammY,
Prisma, and SQLite.

## What runs

The application starts three bots in one Node.js process:

- **Client bot** — onboarding, referrals, catalogue, cart, checkout, receipts,
  profile, and support.
- **Manager bot** — products, customers, receipts, referrals, support,
  announcements, analytics, settings, and courier assignment.
- **Courier bot** — assigned deliveries and delivery status updates.

Telegram updates are received exclusively through long polling. There is no
webhook server, Redis, BullMQ, or PostgreSQL dependency.

## Requirements

- Node.js 20 or newer
- npm 10 or newer
- SQLite 3

## Quick start

```bash
npm ci
npx prisma generate
npx prisma migrate deploy
npm run db:seed
npm run dev
```

Minimum `.env` configuration:

```env
NODE_ENV=development
DATABASE_URL=file:./dev.db
CLIENT_BOT_TOKEN=your_client_bot_token
CLIENT_BOT_USERNAME=your_client_bot_username
MANAGER_BOT_TOKEN=your_manager_bot_token
COURIER_BOT_TOKEN=your_courier_bot_token
ADMIN_TG_USER_ID=your_telegram_user_id
```

Relative SQLite URLs are resolved against `prisma/schema.prisma`, so
`file:./dev.db` points to `prisma/dev.db`. Use an absolute URL in production,
for example `file:/srv/amoosh/prisma/prod.db`.

### Environment variables

| Variable                 |         Required | Purpose                                             |
| ------------------------ | ---------------: | --------------------------------------------------- |
| `DATABASE_URL`           |              Yes | SQLite connection URL                               |
| `CLIENT_BOT_TOKEN`       |              Yes | Customer bot token from BotFather                   |
| `CLIENT_BOT_USERNAME`    |      Recommended | Public customer-bot username used in referral links |
| `MANAGER_BOT_TOKEN`      |              Yes | Manager bot token                                   |
| `COURIER_BOT_TOKEN`      |              Yes | Courier bot token                                   |
| `ADMIN_TG_USER_ID`       | For manager seed | Telegram ID of the initial administrator            |
| `COURIER_TG_USER_ID`     |               No | Telegram ID of an optional seeded courier           |
| `CHECKOUT_IMAGE_FILE_ID` |               No | Fallback Telegram file ID for payment instructions  |
| `SEED_PRODUCTS`          |               No | Set to `true` when running `db:seed:all`            |

## Order workflow

Checkout is automatic; a manager does **not** approve a newly submitted order.

1. The client confirms their phone, Telegram location, and address.
2. Checkout atomically claims the active cart and verifies/decrements stock.
3. The order is created with status `APPROVED`.
4. Payment instructions are sent immediately. The manager bot can configure a
   16-digit card number and holder name, a Sheba number (`IR` + 24 digits) and
   holder name, or both.
5. The order moves to `AWAITING_RECEIPT` while the customer pays.
6. A manager approves or rejects the uploaded receipt.
7. An approved receipt moves the order to `PAID`; delivery can then be assigned.
8. A courier completes the delivery and the order becomes `COMPLETED`.

`AWAITING_MANAGER_APPROVAL` remains in the database enum for historical orders
and backward compatibility. It is not part of the current checkout path.

Stock changes and order creation happen in a transaction. Cancelling an
unfulfilled order restores finite stock exactly once.

## Application structure

```text
src/
├── bots/
│   ├── client/        customer interaction flows
│   ├── manager/       manager flows and extracted feature modules
│   └── courier/       delivery flows
├── config/            validated environment and Telegram command menus
├── infra/
│   ├── scheduler/     in-process recurring work
│   └── telegram/      grammY bot construction
├── jobs/              scheduled job implementations
├── services/          orders, discounts, announcements, notifications, analytics
├── utils/             shared formatting, keyboards, sessions, and safe replies
└── main.ts            polling runtime and graceful shutdown

prisma/
├── migrations/        ordered SQLite migrations
├── schema.prisma      application schema
└── seed.ts            manager, courier, and optional sample-data seed
```

The manager interaction layer is being split by feature. Support conversation
resolution and reply validation live in `manager-support.ts`; future changes
should continue this pattern instead of adding unrelated behavior to
`manager-bot-interactive.ts`.

## Scheduled work

The runtime uses a guarded in-process scheduler. It expires active carts that
have been idle for 24 hours and runs the check once per hour. Only one
application instance should run for a given set of bot tokens and SQLite
database.

## Development

```bash
npm run dev            # run from TypeScript
npm run typecheck      # TypeScript validation
npm run lint           # ESLint
npm test               # test suite
npm run test:coverage  # coverage report and configured thresholds
npm run build          # compile to dist/
npm start              # run compiled output
```

Tests recreate `prisma/test.db` from every checked-in migration. Generated
coverage reports and release archives are intentionally ignored by Git.

All user-facing text is centralized in `src/i18n/texts.ts`. Telegram command
menus are defined in `src/config/bot-commands.ts`; the bots currently expose
only `/start` and use inline keyboards for navigation.

## Database changes

Create a new ordered migration for every schema or one-time data change. Do
not perform migration-style writes during application startup. The username
fallback is therefore applied once by
`20260919120000_backfill_usernames` rather than scanning users on every boot.

For a disposable local database:

```bash
npx prisma migrate deploy
```

For production, use the guarded workflow below.

## Production deployment

SQLite supports only one writer reliably for this deployment model. Stop the
application before migration and keep one polling process per bot token.

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build

sudo systemctl stop amoosh-telegram-bots
npm run db:migrate
sudo systemctl start amoosh-telegram-bots
sudo systemctl status amoosh-telegram-bots
sudo journalctl -u amoosh-telegram-bots -n 100 --no-pager
```

`npm run db:migrate`:

1. resolves and validates the exact SQLite file;
2. verifies integrity and the Prisma migration ledger;
3. creates and verifies an online backup;
4. permits only the expected release migrations;
5. deploys migrations and performs post-deploy integrity and row-count checks.

The default expected release set is:

- `20260819090000_add_announcement_media`
- `20260824120000_add_referral_query_indexes`
- `20260919120000_backfill_usernames`

If the target already has some of these migrations, the remaining subset is
accepted. Override `EXPECTED_PENDING_MIGRATIONS` for a later release. A fully
migrated no-op requires `ALLOW_NOOP=1`.

Backup without deploying:

```bash
npm run db:backup
```

Example systemd unit (`/etc/systemd/system/amoosh-telegram-bots.service`):

```ini
[Unit]
Description=Amoosh Telegram bots
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=amoosh
WorkingDirectory=/srv/amoosh
Environment=NODE_ENV=production
EnvironmentFile=/srv/amoosh/.env
ExecStart=/usr/bin/node /srv/amoosh/dist/main.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Adjust the user and paths to match the server, then run
`sudo systemctl daemon-reload` and `sudo systemctl enable --now amoosh-telegram-bots`.

### Rollback

The deploy script prints the verified backup path and SHA-256. If deployment
checks fail, leave the service stopped, preserve the failed database, restore
the printed backup with SQLite's `.restore`, check `PRAGMA integrity_check`,
then rebuild the previous commit before restarting.

## Branch workflow

- `main` — production-only history. Merge into it only for a production release.
- `dev` — integration branch for changes that have passed automated checks.
- `feature/*` or `fix/*` — short-lived work branches created from `dev`.
- `codex/*` — short-lived Codex work branches, also created from `dev`.

Normal flow:

```text
feature/* or fix/*  ->  dev  ->  main
```

Tag production commits on `main` (for example `v1.4.0`). Do not maintain a
separate long-lived `prod` branch; `main` plus release tags gives the same
signal with less branch drift.

## Troubleshooting

### A bot does not respond

- Verify its token and network access.
- Ensure no other process is polling the same bot token.
- Check the application logs and confirm the SQLite path is correct.

### Manager access is denied

- Confirm the Telegram ID exists in `Manager`.
- Confirm the manager record has `isActive = true`.
- Run `npm run db:seed` with `ADMIN_TG_USER_ID` for the initial admin.

### Database errors

- Stop the running bot before production migrations.
- Verify `DATABASE_URL` points to the intended existing file.
- Run `npx prisma generate` after dependency or schema changes.
- Use `npm run db:migrate` in production so backup and integrity checks run.

## License

Private — all rights reserved.
