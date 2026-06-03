import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log("🌱 Starting database seed...\n");

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

  console.log("\n✅ Database seed complete!");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
