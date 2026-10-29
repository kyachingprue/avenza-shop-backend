const { Router } = require("express");
const { z } = require("zod");
const Stripe = require("stripe");
const env = require("../config/env");
const prisma = require("../db/prisma");
const { authenticate } = require("../middleware/auth");
const { ApiError, asyncHandler, validate } = require("../lib/http");

const router = Router();
const checkoutSchema = z.object({
  items: z.array(z.object({
    productId: z.number().int().positive(),
    quantity: z.number().int().min(1).max(10),
    variantId: z.string().min(1).max(100).optional()
  }).strict()).min(1).max(20)
    .refine((items) => new Set(items.map((item) => `${item.productId}:${item.variantId || ""}`)).size === items.length, {
      message: "Each product option may only appear once"
    })
}).strict();
const sessionIdSchema = z.object({
  id: z.string().regex(/^cs_(test|live)_[A-Za-z0-9]+$/, "Invalid checkout session ID")
});
const stripe = env.STRIPE_CONFIGURED ? new Stripe(env.STRIPE_SECRET_KEY) : null;

router.post(
  "/sessions",
  validate(checkoutSchema),
  authenticate,
  asyncHandler(async (request, response) => {
    const catalogProducts = await prisma.catalogProduct.findMany({
      where: { id: { in: request.body.items.map(({ productId }) => productId) } }
    });
    const products = new Map(catalogProducts.map((product) => [product.id, product.catalogData]));
    const snapshots = request.body.items.map(({ productId, quantity, variantId }) => {
      const product = products.get(productId);
      if (!product) {
        throw new ApiError(404, "PRODUCT_NOT_FOUND", `Product ${productId} was not found`);
      }
      const variant = variantId
        ? product.variants?.find((item) => item.id === variantId)
        : null;
      if (variantId && !variant) {
        throw new ApiError(400, "INVALID_PRODUCT_VARIANT", `The selected option for ${product.name} is unavailable`);
      }
      const price = variant?.price ?? product.price;
      const stock = variant?.stock ?? product.stock;
      if (quantity > stock) {
        throw new ApiError(400, "INSUFFICIENT_STOCK", `${product.name} does not have enough stock`);
      }

      const unitAmount = Math.round(price * 100);
      if (unitAmount < 50) {
        throw new ApiError(400, "INVALID_PRODUCT_PRICE", `${product.name} is below Stripe's minimum charge`);
      }
      const variantLabel = variant && [variant.color, variant.storage, variant.size, variant.option]
        .filter(Boolean)
        .join(" / ");
      return {
        productId,
        variantId: variant?.id ?? null,
        name: product.name,
        variantLabel,
        thumbnail: product.thumbnail,
        price,
        quantity,
        lineItem: {
          quantity,
          price_data: {
            currency: "usd",
            unit_amount: unitAmount,
            product_data: {
              name: [product.name, variantLabel].filter(Boolean).join(" - ")
            }
          }
        }
      };
    });

    if (!stripe) {
      throw new ApiError(503, "PAYMENTS_UNAVAILABLE", "Stripe payments are not configured");
    }

    const order = await prisma.order.create({
      data: {
        userId: request.user.id,
        amountTotal: snapshots.reduce((total, item) => total + Math.round(item.price * 100) * item.quantity, 0),
        currency: "usd",
        items: snapshots.map(({ lineItem, ...item }) => item)
      }
    });

    try {
      const requestOrigin = request.get("origin");
      const frontendUrl = new URL(
        requestOrigin && env.CORS_ORIGIN_LIST.includes(requestOrigin)
          ? requestOrigin
          : env.FRONTEND_URL
      );
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: snapshots.map(({ lineItem }) => lineItem),
        success_url: new URL("/dashboard/payments?session_id={CHECKOUT_SESSION_ID}", frontendUrl).toString(),
        cancel_url: new URL("/checkout/cancel", frontendUrl).toString(),
        client_reference_id: order.id,
        metadata: {
          source: "avenza-storefront",
          orderId: order.id,
          userId: request.user.id
        }
      });
      if (!session.url) {
        throw new ApiError(502, "CHECKOUT_URL_UNAVAILABLE", "Stripe did not return a checkout URL");
      }
      await prisma.order.update({
        where: { id: order.id },
        data: { stripeSessionId: session.id }
      });
      response.status(201).json({ url: session.url });
    } catch (error) {
      await prisma.order.update({
        where: { id: order.id },
        data: { status: "CANCELLED", paymentStatus: "failed" }
      });
      throw error;
    }
  })
);

router.get(
  "/sessions/:id",
  validate(sessionIdSchema, "params"),
  authenticate,
  asyncHandler(async (request, response) => {
    if (!stripe) {
      throw new ApiError(503, "PAYMENTS_UNAVAILABLE", "Stripe payments are not configured");
    }

    const order = await prisma.order.findFirst({
      where: { stripeSessionId: request.params.id, userId: request.user.id }
    });
    if (!order) {
      throw new ApiError(404, "CHECKOUT_SESSION_NOT_FOUND", "Checkout session was not found");
    }
    const session = await stripe.checkout.sessions.retrieve(request.params.id, {
      expand: ["payment_intent.latest_charge"]
    });
    if (session.metadata?.source !== "avenza-storefront" || session.metadata?.orderId !== order.id) {
      throw new ApiError(404, "CHECKOUT_SESSION_NOT_FOUND", "Checkout session was not found");
    }

    const paymentIntent = typeof session.payment_intent === "object" ? session.payment_intent : null;
    const charge = paymentIntent && typeof paymentIntent.latest_charge === "object"
      ? paymentIntent.latest_charge
      : null;
    const paid = session.payment_status === "paid";
    const updatedOrder = await prisma.order.update({
      where: { id: order.id },
      data: {
        status: paid ? "PAID" : order.status,
        paymentStatus: session.payment_status,
        stripePaymentIntentId: paymentIntent?.id ?? order.stripePaymentIntentId,
        amountTotal: session.amount_total ?? order.amountTotal,
        currency: session.currency ?? order.currency,
        customerEmail: session.customer_details?.email ?? session.customer_email ?? null,
        customerDetails: session.customer_details ?? undefined,
        paymentMethodTypes: session.payment_method_types || [],
        receiptUrl: charge?.receipt_url ?? null
      }
    });
    response.json({
      status: session.status,
      paymentStatus: session.payment_status,
      amountTotal: session.amount_total,
      currency: session.currency,
      orderId: updatedOrder.id,
      items: updatedOrder.items,
      customerEmail: updatedOrder.customerEmail,
      paymentMethodTypes: updatedOrder.paymentMethodTypes,
      receiptUrl: updatedOrder.receiptUrl
    });
  })
);

module.exports = router;
