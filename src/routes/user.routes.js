const { Router } = require("express");
const { authenticate, allowRoles } = require("../middleware/auth");
const prisma = require("../db/prisma");
const { z } = require("zod");
const { ApiError, asyncHandler, validate } = require("../lib/http");

const router = Router();
const sellerRequestSchema = z.object({
  message: z.string().trim().min(20).max(1000)
}).strict();
const profileSchema = z.object({
  photoURL: z.string().url().max(2048).refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "i.ibb.co";
  }, "Profile images must be hosted on ImgBB")
}).strict();

router.get("/me", authenticate, (request, response) => {
  const { avatarUrl, ...user } = request.user;
  response.json({ user: { ...user, photoURL: avatarUrl || null } });
});

router.patch(
  "/me",
  authenticate,
  validate(profileSchema),
  asyncHandler(async (request, response) => {
    const updatedUser = await prisma.user.update({
      where: { id: request.user.id },
      data: { avatarUrl: request.body.photoURL },
      select: { id: true, email: true, name: true, avatarUrl: true, role: true }
    });
    const { avatarUrl, ...user } = updatedUser;
    response.json({ user: { ...user, photoURL: avatarUrl || null } });
  })
);

router.get(
  "/seller-requests/me",
  authenticate,
  asyncHandler(async (request, response) => {
    const sellerRequest = await prisma.sellerRequest.findFirst({
      where: { userId: request.user.id },
      orderBy: { createdAt: "desc" }
    });
    response.json({ sellerRequest });
  })
);

router.post(
  "/seller-requests",
  authenticate,
  allowRoles("USER"),
  validate(sellerRequestSchema),
  asyncHandler(async (request, response) => {
    const existing = await prisma.sellerRequest.findFirst({
      where: { userId: request.user.id, status: "PENDING" }
    });
    if (existing) {
      throw new ApiError(409, "SELLER_REQUEST_PENDING", "You already have a seller request awaiting review");
    }

    const sellerRequest = await prisma.sellerRequest.create({
      data: { userId: request.user.id, message: request.body.message }
    });
    response.status(201).json({ sellerRequest });
  })
);

module.exports = router;
