import { PrismaClient, ManagerRole, DiscountType } from "@prisma/client";

const prisma = new PrismaClient();

interface SeedOptions {
  adminTgUserId?: string;
  includeProducts?: boolean;
  includeDiscounts?: boolean;
}

function getOptions(): SeedOptions {
  return {
    adminTgUserId: process.env.ADMIN_TG_USER_ID,
    includeProducts: process.env.SEED_PRODUCTS === "true",
    includeDiscounts: process.env.SEED_DISCOUNTS === "true",
  };
}

async function seedManager(tgUserId: string): Promise<void> {
  const tgUserIdBigInt = BigInt(tgUserId);

  const existing = await prisma.manager.findUnique({
    where: { tgUserId: tgUserIdBigInt },
  });

  if (existing) {
    console.log(`✓ Manager already exists (tgUserId: ${tgUserId})`);
    return;
  }

  await prisma.manager.create({
    data: {
      tgUserId: tgUserIdBigInt,
      role: ManagerRole.ADMIN,
      isActive: true,
    },
  });

  console.log(`✓ Created ADMIN manager (tgUserId: ${tgUserId})`);
}

async function seedProducts(): Promise<void> {
  const products = [
    {
      title: "Basic Package",
      description: "Entry-level package with essential features",
      price: 50000,
      currency: "IRR",
      stock: 100,
      isActive: true,
    },
    {
      title: "Standard Package",
      description: "Most popular package with additional features",
      price: 100000,
      currency: "IRR",
      stock: 50,
      isActive: true,
    },
    {
      title: "Premium Package",
      description: "Full-featured package with all benefits",
      price: 200000,
      currency: "IRR",
      stock: 25,
      isActive: true,
    },
  ];

  for (const product of products) {
    const existing = await prisma.product.findFirst({
      where: { title: product.title },
    });

    if (existing) {
      console.log(`✓ Product "${product.title}" already exists`);
      continue;
    }

    await prisma.product.create({ data: product });
    console.log(`✓ Created product: ${product.title}`);
  }
}

async function seedReferralCodes(managerId: number): Promise<void> {
  const codes = [
    { code: "WELCOME2024", maxUses: 100 },
    { code: "VIP_ACCESS", maxUses: 10 },
  ];

  for (const codeData of codes) {
    const existing = await prisma.referralCode.findUnique({
      where: { code: codeData.code },
    });

    if (existing) {
      console.log(`✓ Referral code "${codeData.code}" already exists`);
      continue;
    }

    await prisma.referralCode.create({
      data: {
        code: codeData.code,
        createdByManagerId: managerId,
        maxUses: codeData.maxUses,
        isActive: true,
      },
    });
    console.log(`✓ Created referral code: ${codeData.code}`);
  }
}

async function seedDiscounts(): Promise<void> {
  const discounts = [
    {
      code: "WELCOME10",
      type: DiscountType.PERCENT,
      value: 10,
      perUserLimit: 1,
      isActive: true,
    },
    {
      code: "FLAT5000",
      type: DiscountType.FIXED,
      value: 5000,
      perUserLimit: 1,
      isActive: true,
    },
    {
      autoRule: "first_order",
      type: DiscountType.PERCENT,
      value: 15,
      isActive: true,
    },
  ];

  for (const discount of discounts) {
    const identifier = discount.code || discount.autoRule;

    if (discount.code) {
      const existing = await prisma.discount.findUnique({
        where: { code: discount.code },
      });
      if (existing) {
        console.log(`✓ Discount "${identifier}" already exists`);
        continue;
      }
    } else {
      const existing = await prisma.discount.findFirst({
        where: { autoRule: discount.autoRule },
      });
      if (existing) {
        console.log(`✓ Discount "${identifier}" already exists`);
        continue;
      }
    }

    await prisma.discount.create({ data: discount });
    console.log(`✓ Created discount: ${identifier}`);
  }
}

async function main(): Promise<void> {
  console.log("🌱 Starting database seed...\n");

  const options = getOptions();

  // Seed manager (required)
  let managerId: number | null = null;
  if (options.adminTgUserId) {
    console.log("--- Seeding Manager ---");
    await seedManager(options.adminTgUserId);
    const manager = await prisma.manager.findUnique({
      where: { tgUserId: BigInt(options.adminTgUserId) },
    });
    managerId = manager?.id ?? null;
    console.log("");

    // Seed referral codes (always seed when manager exists)
    if (managerId) {
      console.log("--- Seeding Referral Codes ---");
      await seedReferralCodes(managerId);
      console.log("");
    }
  } else {
    console.log("⚠️  ADMIN_TG_USER_ID not set. Skipping manager seed.");
    console.log("   To seed a manager, set ADMIN_TG_USER_ID in your .env file.");
    console.log("   Get your Telegram user ID from @userinfobot on Telegram.\n");
  }

  // Seed products (optional)
  if (options.includeProducts) {
    console.log("--- Seeding Products ---");
    await seedProducts();
    console.log("");
  }

  // Seed discounts (optional)
  if (options.includeDiscounts) {
    console.log("--- Seeding Discounts ---");
    await seedDiscounts();
    console.log("");
  }

  console.log("✅ Database seed complete!");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
