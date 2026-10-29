const { Router } = require("express");
const { z } = require("zod");
const prisma = require("../db/prisma");
const { ApiError, asyncHandler, validate } = require("../lib/http");

const router = Router();
const productIdSchema = z.object({ id: z.coerce.number().int().positive() });
const postIdSchema = z.object({ id: z.string().min(1).max(100) });

router.get(
  "/products",
  asyncHandler(async (request, response) => {
    const products = await prisma.catalogProduct.findMany({
      orderBy: { id: "asc" },
      select: { catalogData: true }
    });
    response.json({ products: products.map(({ catalogData }) => catalogData) });
  })
);

router.get(
  "/products/:id",
  validate(productIdSchema, "params"),
  asyncHandler(async (request, response) => {
    const product = await prisma.catalogProduct.findUnique({
      where: { id: request.params.id },
      select: { catalogData: true }
    });
    if (!product) throw new ApiError(404, "PRODUCT_NOT_FOUND", "Product was not found");
    response.json({ product: product.catalogData });
  })
);

router.get(
  "/posts",
  asyncHandler(async (request, response) => {
    const posts = await prisma.catalogPost.findMany({
      orderBy: { id: "asc" },
      select: { postData: true }
    });
    response.json({ posts: posts.map(({ postData }) => postData) });
  })
);

router.get(
  "/posts/:id",
  validate(postIdSchema, "params"),
  asyncHandler(async (request, response) => {
    const post = await prisma.catalogPost.findUnique({
      where: { id: request.params.id },
      select: { postData: true }
    });
    if (!post) throw new ApiError(404, "POST_NOT_FOUND", "Post was not found");
    response.json({ post: post.postData });
  })
);

module.exports = router;
