# Food Delivery Server – Architecture

This document explains the `food-delivery-server` backend architecture for developers: how the codebase is organized into modules, how requests travel through layers, and how the “place an order” flow works end-to-end.

## 1. Architecture overview

- **Style**: **Modular Monolith** (NestJS) with **layered structure**
  - A single backend service, split into **business modules** (`src/modules/*`).
  - **Infrastructure** is separated under `src/infra/*` (DB/Redis/Stripe/Cloudinary/etc.).
- **API prefix**: all HTTP routes are served under **`/api`** (see `src/main.ts`).
- **Database access**: Prisma ORM → MySQL (`DATABASE_URL`).

## 2. Architecture diagram (text)

```text
Client (Web/Mobile)
  └─ HTTP (JSON) + Bearer JWT
      └─ NestJS Controller (src/modules/*/*.controller.ts)
          └─ Service (src/modules/*/*.service.ts)
              ├─ Repository (src/infra/repositories/*.repository.ts)
              │   └─ Prisma Client (src/infra/prisma)
              │       └─ MySQL
              ├─ Infra integrations
              │   ├─ Redis (src/infra/redis)  [optional]
              │   ├─ Stripe (src/infra/stripe + src/modules/payments)
              │   └─ Cloudinary (src/infra/cloudinary)
              └─ External APIs
                  ├─ Google OAuth
                  ├─ SMTP (Nodemailer)
                  └─ Gemini API (Health AI)
```

## 3. Layers

### 3.1 Controller

- **Responsibilities**:
  - Receive requests (params/body/query/header/cookies)
  - Perform auth checks (some routes verify tokens directly via `AuthService`)
  - Call the corresponding service and return JSON responses
- **Location**: `src/modules/<module>/*.controller.ts`
- **Examples**: `orders`, `cart`, `payments`, `auth`, ...

### 3.2 Service (business logic)

- **Responsibilities**:
  - Core domain/business logic (compute totals, validate constraints, orchestrate flows)
  - Coordinate repositories and integrations (Stripe/Redis/Cloudinary/etc.)
- **Location**: `src/modules/<module>/*.service.ts`

### 3.3 Repository (data access)

- **Responsibilities**:
  - Encapsulate Prisma/SQL queries per use-case
  - Keep DB access separate from services to improve testability and maintainability
- **Location**: `src/infra/repositories/*.repository.ts`

### 3.4 Database

- **MySQL** via Prisma
- **Schema & migrations**:
  - `prisma/schema.prisma`
  - `prisma/migrations/*`

## 4. Request flow (example: placing an order)

Common flow: an authenticated user adds items → checks out → the system creates an order.

### 4.1 Cart creation and adding items

```text
Client
  └─ POST /api/cart/items (foodId, quantity, note)
      └─ CartController
          ├─ Identify actor:
          │   ├─ User (from JWT/x-user-id)
          │   └─ Guest (from cookie guest_token)
          ├─ If cartId is missing → CartService.createActiveCart(...)
          ├─ CartService.upsertCartItem(...)
          └─ Return cart snapshot
```

- **Redis** (if configured) is used for cart caching/snapshots; if `REDIS_URL` is missing the server still runs, but Redis-backed features become **no-op**.

### 4.2 Payment checkout (Stripe)

```text
Client
  └─ POST /api/payments/create-checkout-session
      └─ PaymentsController (requires Bearer JWT)
          └─ PaymentsService
              └─ StripeCheckoutService
                  └─ Stripe API → returns { url, sessionId }
```

The client redirects the user to Stripe Checkout using the returned `url`.

### 4.3 Successful payment → recording and order creation

Two common options (depending on frontend implementation):

- **(A) Client calls the “success” API after returning to the app**

```text
Client (after Stripe redirect)
  └─ POST /api/payments/process-checkout-success (sessionId)
      └─ PaymentsController (requires Bearer JWT)
          └─ PaymentsService
              └─ CheckoutSuccessService
                  ├─ Validate session/payment status via Stripe
                  └─ (implementation-dependent) update payment/order in DB
```

- **(B) Stripe sends webhooks to the server**

```text
Stripe
  └─ POST /api/webhooks/... (signature)
      └─ WebhooksController/handler
          ├─ Verify signature using STRIPE_WEBHOOK_SECRET
          └─ Dispatch event handlers (payment succeeded, ...)
```

### 4.4 Order creation in the database

The simplified order creation flow typically happens in `OrdersService` + `OrdersRepository`:

```text
Client
  └─ POST /api/orders (cartItems, deliveryInfo, voucherCode?, paymentIntentId?)
      └─ OrdersController (requires Bearer JWT)
          └─ OrdersService.createForCustomer(accountId, dto)
              ├─ Load customer profile
              ├─ Validate cartItems is not empty
              ├─ Validate food availability (repo)
              ├─ Compute subtotal/fees/discounts → total
              ├─ Apply voucher (if provided)
              └─ Repo.createOrderWithDetailsAndPayment(...)
                  └─ Prisma transaction → MySQL
```

The API returns `{ orderId, total }` so the client can show the order status/summary.

## 5. External services

### 5.1 Payment

- **Stripe**: create checkout sessions, query session status, receive webhook events
  - Env: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `APP_URL`
- **MoMo / VNPay (planned / not wired yet)**:
  - The `.env` contains `VNP_*` variables, but the current `src/` code does **not** show VNPay/MoMo routes/services.
  - If you want to enable them, create a dedicated submodule (e.g. `src/modules/payments/vnpay/*`) and integrate via the `PaymentsService` facade pattern.

### 5.2 Redis / Queue

- **Redis** (optional): `src/infra/redis`
  - Used for caching/snapshots (e.g. cart) and key-pattern helpers
  - If `REDIS_URL` is not configured, the server will not crash; Redis calls return `null`/no-op
- **Queue**: no queue system found yet (BullMQ/RabbitMQ/...) in current dependencies

### 5.3 Media (Cloudinary)

- Upload images (avatars/reviews/etc.) via Cloudinary
- Env: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `CLOUDINARY_UPLOAD_FOLDER`

### 5.4 Auth integrations

- **Google OAuth**: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (flow lives in the auth module)
- **SMTP**: send password reset emails (Nodemailer)

### 5.5 Health AI (Gemini)

- The `health` module calls the **Gemini API**
- Env: `GEMINI_API_KEY`

## 6. Scalability & Performance

- **Cache**:
  - Redis is **optional**: enable for performance (especially cart), disable and the API still runs.
- **DB performance**:
  - Prisma + MySQL: optimize via schema/indexes and query shapes in repositories.
  - Recommendation: slow query logging + pagination (already used in orders list).
- **Load balancing** (deployment):
  - Run multiple API instances behind a reverse proxy/load balancer (Nginx/Cloud LB/K8s Service).
  - Ensure shared state lives in DB/Redis, not in process memory.
- **Webhook idempotency**:
  - Payment webhook handlers should be idempotent (apply once) to tolerate retries from Stripe.

## 7. Security

### 7.1 Auth (JWT, OAuth)

- **JWT Bearer token**: many controllers read `Authorization: Bearer <token>` and verify via `AuthService`.
- **`JwtAuthGuard`** exists (`src/common/guards/jwt-auth.guard.ts`) to standardize auth; however, not all controllers use it yet (some perform manual verification).
- **OAuth**: Google OAuth via environment configuration.

### 7.2 Input validation

- Some endpoints currently validate manually (null/empty checks, number parsing).
- Recommendation (NestJS best practice):
  - DTOs + `class-validator` + a global `ValidationPipe` for consistent validation and error responses.

### 7.3 Secrets & environment

- Do not commit `.env` (use `.env.example` only).
- If secrets were exposed, rotate them:
  - JWT secret, SMTP app password, OAuth client secret, Stripe keys, Cloudinary secret, etc.

