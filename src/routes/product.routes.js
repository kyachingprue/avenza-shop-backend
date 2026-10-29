const { Router } = require("express");
const { z } = require("zod");
const prisma = require("../db/prisma");
const { ApiError, asyncHandler, validate } = require("../lib/http");

const router = Router();
const productIdSchema = z.object({ id: z.string().uuid() });
const commentsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

router.get(
  "/",
  asyncHandler(async (request, response) => {
    const products = await prisma.product.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        seller: { select: { id: true, name: true } },
        _count: { select: { comments: true } }
      }
    });
    response.json({ products });
  })
);

router.get(
  "/:id/comments",
  validate(productIdSchema, "params"),
  validate(commentsQuerySchema, "query"),
  asyncHandler(async (request, response) => {
    const product = await prisma.product.findUnique({
      where: { id: request.params.id },
      select: { id: true }
    });
    if (!product) throw new ApiError(404, "PRODUCT_NOT_FOUND", "Product was not found");

    const comments = await prisma.comment.findMany({
      where: { productId: product.id },
      orderBy: { createdAt: "desc" },
      take: request.query.limit,
      include: { author: { select: { id: true, name: true } } }
    });
    response.json({ comments });
  })
);

module.exports = router;
