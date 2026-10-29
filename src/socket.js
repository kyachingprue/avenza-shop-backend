const jwt = require("jsonwebtoken");
const { z } = require("zod");
const env = require("./config/env");
const prisma = require("./db/prisma");
const { ApiError } = require("./lib/http");
const { SESSION_COOKIE_NAME } = require("./auth/session-cookie");

const productIdSchema = z.string().uuid();
const commentSchema = z.object({
  productId: z.string().uuid(),
  content: z.string().trim().min(1).max(2000)
}).strict();

function productRoom(productId) {
  return `product:${productId}`;
}

function socketError(socket, error) {
  socket.emit("socket:error", {
    code: error instanceof ApiError ? error.code : "REQUEST_FAILED",
    message: error instanceof ApiError ? error.message : "The realtime request failed"
  });
}

function attachSockets(io) {
  io.use(async (socket, next) => {
    const token = socket.request.cookies?.[SESSION_COOKIE_NAME]
      || (socket.handshake.auth && socket.handshake.auth.token);
    if (typeof token !== "string" || !token) {
      return next(new Error("Authentication required"));
    }

    try {
      const claims = jwt.verify(token, env.JWT_SECRET, {
        algorithms: ["HS256"],
        issuer: "e-commerce-backend",
        audience: "e-commerce-client"
      });
      if (typeof claims !== "object" || typeof claims.sub !== "string") {
        return next(new Error("Invalid access token"));
      }

      const user = await prisma.user.findUnique({
        where: { id: claims.sub },
        select: { id: true, name: true, role: true, emailVerified: true }
      });
      if (!user || !user.emailVerified) return next(new Error("Account unavailable"));
      socket.data.user = user;
      next();
    } catch {
      next(new Error("Invalid or expired access token"));
    }
  });

  io.on("connection", (socket) => {
    socket.data.joinedProducts = new Set();
    socket.data.commentTimes = [];

    socket.on("product:join", async (productId) => {
      try {
        const parsedId = productIdSchema.safeParse(productId);
        if (!parsedId.success) throw new ApiError(400, "INVALID_PRODUCT_ID", "A valid product ID is required");

        const exists = await prisma.product.findUnique({
          where: { id: parsedId.data },
          select: { id: true }
        });
        if (!exists) throw new ApiError(404, "PRODUCT_NOT_FOUND", "Product was not found");

        const room = productRoom(parsedId.data);
        await socket.join(room);
        socket.data.joinedProducts.add(parsedId.data);
        socket.emit("product:joined", { productId: parsedId.data });
      } catch (error) {
        socketError(socket, error);
      }
    });

    socket.on("product:leave", async (productId) => {
      try {
        const parsedId = productIdSchema.safeParse(productId);
        if (!parsedId.success) {
          throw new ApiError(400, "INVALID_PRODUCT_ID", "A valid product ID is required");
        }
        await socket.leave(productRoom(parsedId.data));
        socket.data.joinedProducts.delete(parsedId.data);
      } catch (error) {
        socketError(socket, error);
      }
    });

    socket.on("product:comment", async (payload) => {
      try {
        const parsed = commentSchema.safeParse(payload);
        if (!parsed.success) {
          throw new ApiError(400, "INVALID_COMMENT", "A product ID and comment of 1–2000 characters are required");
        }
        if (!socket.data.joinedProducts.has(parsed.data.productId)) {
          throw new ApiError(403, "JOIN_PRODUCT_FIRST", "Join the product room before commenting");
        }

        const now = Date.now();
        socket.data.commentTimes = socket.data.commentTimes.filter((time) => now - time < 10000);
        if (socket.data.commentTimes.length >= 5) {
          throw new ApiError(429, "COMMENT_RATE_LIMITED", "Please wait before posting another comment");
        }
        socket.data.commentTimes.push(now);

        const comment = await prisma.comment.create({
          data: {
            productId: parsed.data.productId,
            authorId: socket.data.user.id,
            content: parsed.data.content
          },
          include: { author: { select: { id: true, name: true } } }
        });
        io.to(productRoom(parsed.data.productId)).emit("product:comment", comment);
      } catch (error) {
        socketError(socket, error);
      }
    });
  });
}

module.exports = { attachSockets };
