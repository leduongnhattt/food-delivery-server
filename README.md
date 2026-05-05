## Food Delivery Server

Backend API for the **Food Delivery** system (food ordering app). This service provides APIs for:

- **Authentication & authorization** (JWT, Google sign-in)
- **Foods / restaurants / menus**
- **Cart & orders**
- **Payments** (Stripe Checkout + webhooks)
- **Media uploads** (Cloudinary)
- **Health AI feature** (Gemini-based health profile analysis)

Primary goal: centralize “food ordering” domain logic into a single backend that is easy to extend and integrate with the frontend.

## Demo / Screenshot

- Not available yet (add screenshots here if you have them).

## Tech stack

- **Backend**: NestJS (TypeScript), Prisma ORM
- **Frontend**: see `food-delivery-app` (same repository)
- **Database**: MySQL
- **Other**: Redis (optional cache/session), Stripe, Cloudinary, Nodemailer, Google OAuth, Gemini API

## Key features

- **Auth**: login/register, refresh token, Google OAuth
- **Foods / Restaurants / Menu items**: CRUD + search/filter
- **Cart**: user/guest cart
- **Orders**: place orders, track status
- **Payments**: create Stripe checkout, handle callbacks/webhooks
- **Vouchers**: discount codes
- **Reviews**: food/restaurant reviews
- **Admin**: administration modules (depending on enabled modules)
- **Health (AI)**: health profile analysis (Gemini)

## Quick start

### Clone repo

```bash
git clone <your-repo-url>
cd food-delivery-server
```

### Install dependencies

```bash
npm install
```

### Environment setup

1) Create a local `.env` from the template:

```bash
copy .env.example .env
```

2) Update values in `.env` for your environment (DB, JWT secret, Stripe, etc.).

### Run project (dev)

```bash
npm run db:generate
npm run db:migrate
npm run start:dev
```

The API uses a global `/api` prefix (default `http://localhost:3001/api`).

## Directory structure (brief)

```text
food-delivery-server/
  prisma/                 Prisma schema + migrations
  src/
    common/               shared guards, filters, interceptors
    config/               configuration (app/db...)
    infra/                infrastructure integrations (Prisma, Redis, Stripe, Cloudinary, repositories)
    modules/              business modules (auth, foods, orders, payments, ...)
    shared/               shared utilities
    main.ts               entrypoint, CORS, global prefix (/api)
```

## Environment variables

This project reads `.env` from the project root (it is loaded even when running from `dist/`). See `.env.example`.

- **Database**
  - `DATABASE_URL`: MySQL connection string (Prisma)
- **Server**
  - `PORT`: port API (default `3001`)
  - `CORS_ORIGIN`: comma-separated origins (optional)
- **Auth**
  - `JWT_SECRET`: JWT signing secret (**recommended >= 32 chars**)
  - `ACCESS_TOKEN_TTL`: e.g. `15m`
  - `REFRESH_TOKEN_TTL_DAYS`: e.g. `7`
- **SMTP (password reset / email)**
  - `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `APP_NAME`
- **Google OAuth**
  - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
  - `API_URL`: server public URL for redirect/callback configuration (optional)
  - `FRONTEND_ORIGIN`: frontend URL used for callback/postMessage (optional)
- **Cloudinary (uploads)**
  - `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`
  - `CLOUDINARY_UPLOAD_FOLDER` (optional)
- **Redis (optional)**
  - `REDIS_URL`
- **Stripe**
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET`
  - `APP_URL`: frontend base URL for checkout success/cancel redirects
- **Health AI (Gemini)**
  - `GEMINI_API_KEY`: required for `POST /health/ai-analyze` and `POST /health/gemini-analyze` (Google Generative Language API; server calls Gemini directly, not the Python FastAPI service)
  - `GEMINI_MODEL` (optional): e.g. `gemini-2.0-flash`; if unset, the server tries a small built-in list of model names
  - `GEMINI_BASE_URL` (optional): default `https://generativelanguage.googleapis.com/v1beta`
  - Optional FastAPI client (`HEALTH_AI_BASE_URL`, `HEALTH_AI_ENABLED`) remains in `healthAiHttp.service.ts` for reuse or custom wiring; the health analyze routes above use Gemini only

> Note: **Do not commit** `.env` to git. If secrets were ever committed/pushed, rotate them immediately.

## Contributors

- (Add contributors here)

## License

UNLICENSED
