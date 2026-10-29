# E-commerce backend

Express REST API with PostgreSQL via Prisma, JWT sessions, email verification,
Firebase-backed Google sign-in, role-protected seller/admin endpoints, and
authenticated Socket.IO product comments.

## Requirements

- Node.js 22 or newer
- PostgreSQL (Neon is supported)
- SMTP credentials to use password signup and email verification
- A Firebase project ID to use Google sign-in
- A Stripe secret key to enable hosted Checkout

## Local setup

1. From `backend/`, install dependencies and create your local environment:

   ```sh
   npm install
   cp .env.example .env
   ```

   On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp`.
2. Set `DATABASE_URL` to your PostgreSQL/Neon connection string, generate a
   random `JWT_SECRET` of at least 32 characters, and set `CORS_ORIGINS` to the
   exact frontend origin(s), comma-separated. The example intentionally leaves
   credentials blank; do not commit your populated `.env` file. Configure every `SMTP_*` value
   together to enable email signup (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
   `SMTP_PASS`, and `SMTP_FROM`). For example, Gmail uses `smtp.gmail.com` on
   port `587` with a Google app password (not the account password), and the
   sender address should be authorized by your provider. For Google sign-in, set
   `FIREBASE_PROJECT_ID` to the same Firebase project ID used by the frontend.
   The backend verifies Firebase ID tokens using Google's public signing keys;
   it does not need a service-account file or Firebase Web API key. Token
   revocation is not checked. To enable payments, set `STRIPE_SECRET_KEY`
   to a Stripe test key for local development and set `FRONTEND_URL` to the
   frontend origin used for Checkout return URLs.
3. Generate the Prisma client, apply the committed migrations, and import the
   complete storefront catalog:

   ```sh
   npm run prisma:generate
   npm run prisma:deploy
   npm run catalog:sync
   npm run posts:sync
   ```

   `catalog:sync` safely upserts each product from
   `../frontend/public/products.json`; rerunning it updates existing catalog
   rows instead of creating duplicates. Full product details are retained in
   PostgreSQL as JSONB and served by `/api/catalog/products`.
   `posts:sync` imports all posts from `../frontend/public/posts.json` into
   PostgreSQL as JSONB; the listing and detail records are served by
   `/api/catalog/posts` and `/api/catalog/posts/:id`.
4. Start the server:

   ```sh
   npm run dev
   ```

   The server prints `Database connected` after PostgreSQL successfully
   connects. The health endpoint is `GET http://localhost:4000/api/health`.

Prisma 7 reads its connection URL from `prisma.config.ts`; client generation
uses a local placeholder URL only if `DATABASE_URL` is unset, and does not
connect to a database. Migrations require a real `DATABASE_URL`.

For production, generate the client during build and apply committed migrations
with `npm run prisma:deploy`, then start with `npm start`. Create the first
administrator by promoting a verified user through a trusted, out-of-band
database operation; the public signup and Google sign-in flows always create
ordinary `USER` accounts. There is intentionally no public admin bootstrap
endpoint.

### Deploying the API to Vercel

If the backend Vercel project is connected to the parent repository, set its
Root Directory to `backend`; if it is connected directly to the backend
repository, keep the Root Directory at `./`. The Express app in `src/server.js`
is exported for Vercel's Express runtime; running `npm start` locally still
starts the HTTP and Socket.IO server.

Add backend variables under the Vercel project's Settings → Environment
Variables; the ignored `backend/.env` file is only for local development. At
minimum, configure `DATABASE_URL`, `JWT_SECRET` (at least 32 characters), and
`CORS_ORIGINS`. For this storefront, set `CORS_ORIGINS` to
`https://avenza-shopping.vercel.app` (add any other allowed origins as a
comma-separated list, without trailing slashes). Set `FRONTEND_URL` to the
storefront origin when enabling Stripe Checkout. Redeploy after changing
environment variables.

Run the backend HTTP smoke tests with `npm test`; these do not require a live
database, SMTP server, or Firebase project.

## API outline

- `POST /api/auth/signup` — `{ "email", "name", "password" }`; sends a six-digit
  verification code. Passwords must be at least 12 characters.
- `POST /api/auth/verify-email` — `{ "email", "code" }`; returns an access token.
- `POST /api/auth/resend-verification` — `{ "email" }`.
- `POST /api/auth/login` — `{ "email", "password" }`; requires verified email.
- `POST /api/auth/google` — `{ "idToken" }` from Firebase client authentication.
- `GET /api/users/me` — authenticated profile.
- `GET /api/products` and `GET /api/products/:id/comments?limit=50`.
- `GET /api/catalog/products` and `GET /api/catalog/products/:id` — full
  storefront catalog records stored in PostgreSQL.
- `GET /api/catalog/posts` and `GET /api/catalog/posts/:id` — full post records
  stored in PostgreSQL.
- `GET /api/orders` and `GET /api/payments` — the signed-in customer's order
  tracking and payment history.
- `POST /api/users/seller-requests` and `GET /api/users/seller-requests/me` —
  submit and view seller access requests.
- `GET /api/admin/seller-requests` and
  `PATCH /api/admin/seller-requests/:id` — review requests; approval grants the
  seller role.
- `POST /api/checkout/sessions` — `{ "items": [{ "productId": 1, "quantity": 1 }] }`;
  requires a signed-in user and creates a Stripe-hosted Checkout session using
  server-side prices from the PostgreSQL catalog. A selected option can include
  `variantId`. Completed payment details are synchronized when the customer
  returns to the dashboard payment route.
- `GET /api/checkout/sessions/:id` — returns the payment status of an Avenza
  Checkout session for the success page.
- `GET|POST /api/seller/products` — authenticated `SELLER` or `ADMIN`.
- `GET /api/admin/users` and
  `PATCH /api/admin/users/:id/role` — `ADMIN` only.

Login, email verification, and Google sign-in set a one-hour, HttpOnly
`avenza_session` cookie. The browser sends it automatically to the API; the
frontend does not read or store the token. Local cookies use `SameSite=Lax`;
production cookies use `SameSite=None; Secure` for cross-origin deployments,
and unsafe cookie-authenticated requests are restricted to `CORS_ORIGINS`.
The API also accepts bearer tokens for non-browser clients. Admin role
assignment is restricted to the admin API. The initial admin must be assigned
manually through a trusted database session.

## Realtime comments

Connect to the API using Socket.IO; browser clients authenticate with the
`avenza_session` cookie. Non-browser clients may provide
`auth: { token: "<access token>" }`. Clients must join an existing product room
before posting. Supported events:

- Client `product:join` with the product UUID; server acknowledges
  `product:joined`.
- Client `product:leave` with the product UUID.
- Client `product:comment` with `{ "productId": "<uuid>", "content": "..." }`.
- Server broadcasts persisted comments as `product:comment` to that product's
  room; failures are returned as `socket:error`.

Every connection is authenticated against the database, room names are derived
only from validated existing product IDs, and comments are rate-limited per
connection. Product comments are persisted before they are broadcast.

## Configuration and security notes

Configuration is validated at startup and invalid/missing required values stop
the server with a readable error. SMTP and Firebase are optional integrations;
their endpoints return `503` until configured. Never commit `.env` files or
Firebase service-account credentials. HTTPS should be terminated by the
deployment platform, with the origin allowlist configured to match the deployed
frontend. Checkout requires `STRIPE_SECRET_KEY`; do not expose it through a
`VITE_` frontend variable. Deploy `frontend/public/products.json` at the
documented repository-relative path so the backend can validate prices and
stock against the same trusted catalog.

The current checkout integration creates Stripe payments and verifies their
status, but does not persist orders or decrement inventory. Add order
persistence and fulfillment handling before relying on it for production
fulfillment.
