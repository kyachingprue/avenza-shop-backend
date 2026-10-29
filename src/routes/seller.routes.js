const { Router } = require("express");
const { z } = require("zod");
const { authenticate, allowRoles } = require("../middleware/auth");
const prisma = require("../db/prisma");
const { asyncHandler, validate } = require("../lib/http");

const router = Router();
const createProductSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(10000),
  price: z.coerce.number().positive().max(99999999.99),
  imageUrl: z.string().url().max(2048).optional()
}).strict();

router.use(authenticate, allowRoles("SELLER", "ADMIN"));

router.get(
  "/products",
  asyncHandler(async (request, response) => {
    const products = await prisma.product.findMany({
      where: request.user.role === "ADMIN" ? {} : { sellerId: request.user.id },
      orderBy: { createdAt: "desc" }
    });
    response.json({ products });
  })
);

router.post(
  "/products",
  validate(createProductSchema),
  asyncHandler(async (request, response) => {
    const product = await prisma.product.create({
      data: {
        ...request.body,
        sellerId: request.user.id
      }
    });
    response.status(201).json({ product });
  })
);

module.exports = router;
