const { Router } = require("express");
const { authenticate } = require("../middleware/auth");
const prisma = require("../db/prisma");
const { asyncHandler } = require("../lib/http");

const router = Router();

router.get(
  "/",
  authenticate,
  asyncHandler(async (request, response) => {
    const orders = await prisma.order.findMany({
      where: { userId: request.user.id },
      orderBy: { createdAt: "desc" }
    });
    response.json({ payments: orders.map((order) => ({
      ...order,
      paymentStatus: order.paymentStatus,
      paymentMethodTypes: order.paymentMethodTypes
    })) });
  })
);

module.exports = router;
