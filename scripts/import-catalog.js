const fs = require("node:fs");
const path = require("node:path");
const { z } = require("zod");
const prisma = require("../src/db/prisma");

const catalogPath = path.resolve(__dirname, "../../frontend/public/products.json");
const productSchema = z.object({
  id: z.number().int().positive(),
  slug: z.string().min(1),
  name: z.string().min(1),
  brand: z.string().min(1),
  category: z.string().min(1),
  price: z.number().positive(),
  stock: z.number().int().nonnegative()
}).passthrough();

async function importCatalog() {
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  const products = z.array(productSchema).parse(catalog);
  if (new Set(products.map(({ id }) => id)).size !== products.length) {
    throw new Error("Catalog contains duplicate product IDs");
  }

  for (const product of products) {
    await prisma.catalogProduct.upsert({
      where: { id: product.id },
      create: {
        id: product.id,
        slug: product.slug,
        name: product.name,
        brand: product.brand,
        category: product.category,
        price: product.price,
        stock: product.stock,
        catalogData: product
      },
      update: {
        slug: product.slug,
        name: product.name,
        brand: product.brand,
        category: product.category,
        price: product.price,
        stock: product.stock,
        catalogData: product
      }
    });
  }

  const importedCount = await prisma.catalogProduct.count();
  console.log(`Catalog sync complete: ${products.length} products imported; ${importedCount} stored.`);
}

importCatalog()
  .catch((error) => {
    console.error("Catalog sync failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
