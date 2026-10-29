const { Router } = require("express");
const { z } = require("zod");
const { authenticate, allowRoles } = require("../middleware/auth");
const prisma = require("../db/prisma");
const { ApiError, asyncHandler, validate } = require("../lib/http");

const router = Router();
const userIdSchema = z.object({ id: z.string().uuid() });
const roleSchema = z.object({
  role: z.enum(["USER", "SELLER", "ADMIN"])
}).strict();
const sellerRequestIdSchema = z.object({ id: z.string().uuid() });
const sellerRequestDecisionSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"])
}).strict();

router.use(authenticate, allowRoles("ADMIN"));

router.get(
  "/users",
  asyncHandler(async (request, response) => {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        emailVerified: true,
        createdAt: true
      }
    });
    response.json({ users });
  })
);

router.patch(
  "/users/:id/role",
  validate(userIdSchema, "params"),
  validate(roleSchema),
  asyncHandler(async (request, response) => {
    const user = await prisma.user.update({
      where: { id: request.params.id },
      data: { role: request.body.role },
      select: { id: true, email: true, name: true, role: true }
    }).catch((error) => {
      if (error.code === "P2025") {
        throw new ApiError(404, "USER_NOT_FOUND", "User was not found");
      }
      throw error;
    });
    response.json({ user });
  })
);

router.get(
  "/seller-requests",
  asyncHandler(async (request, response) => {
    const sellerRequests = await prisma.sellerRequest.findMany({
      orderBy: [{ status: "asc" }, { createdAt: "asc" }],
      take: 200,
      include: {
        user: { select: { id: true, name: true, email: true, role: true } }
      }
    });
    response.json({ sellerRequests });
  })
);

router.patch(
  "/seller-requests/:id",
  validate(sellerRequestIdSchema, "params"),
  validate(sellerRequestDecisionSchema),
  asyncHandler(async (request, response) => {
    const { id } = request.params;
    const { status } = request.body;
    const existing = await prisma.sellerRequest.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, "SELLER_REQUEST_NOT_FOUND", "Seller request was not found");
    if (existing.status !== "PENDING") {
      throw new ApiError(409, "SELLER_REQUEST_ALREADY_REVIEWED", "This seller request has already been reviewed");
    }

    const sellerRequest = await prisma.$transaction(async (transaction) => {
      if (status === "APPROVED") {
        await transaction.user.update({
          where: { id: existing.userId },
          data: { role: "SELLER" }
        });
      }
      return transaction.sellerRequest.update({
        where: { id },
        data: {
          status,
          reviewedById: request.user.id,
          reviewedAt: new Date()
        },
        include: {
          user: { select: { id: true, name: true, email: true, role: true } }
        }
      });
    });
    response.json({ sellerRequest });
  })
);

module.exports = router;
