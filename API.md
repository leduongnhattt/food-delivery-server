# Food Delivery Server – API Reference

This document describes the HTTP APIs exposed by `food-delivery-server` in a frontend-friendly format.

## 1. Base URL

- **Local (default)**: `http://localhost:3001/api`
- **Notes**
  - The server sets a global prefix to **`/api`**.
  - Some endpoints require authentication via **JWT Bearer token**.

## 2. Authentication

### 2.1 Bearer access token (JWT)

Send the access token in the `Authorization` header:

```http
Authorization: Bearer <accessToken>
```

### 2.2 Refresh token (cookie)

- Login endpoints set an **HTTP-only cookie** named `refresh_token`.
- To refresh an access token, call `POST /api/auth/refresh`.

### 2.3 Common headers

- **JSON requests**

```http
Content-Type: application/json
```

- **Authenticated requests**

```http
Authorization: Bearer <accessToken>
```

## 3. API list

> **Response shapes**: Some endpoints directly return service results; the examples below show the common/expected structure. Actual responses may include additional fields.

### Health check

### API root
- **Method**: GET  
- **Endpoint**: `/api/`  
- **Description**: Basic server response (hello).

#### Request
- **Headers**: none

#### Response
- **Success (200)**:

```json
"Hello World!"
```

---

### DB health
- **Method**: GET  
- **Endpoint**: `/api/health`  
- **Description**: Health endpoint + DB connectivity status.

#### Request
- **Headers**: none

#### Response
- **Success (200)**:

```json
{ "status": "ok", "db": "connected" }
```

---

### DB check (version)
- **Method**: GET  
- **Endpoint**: `/api/db-check`  
- **Description**: Verifies DB connectivity and returns MySQL version.

#### Request
- **Headers**: none

#### Response
- **Success (200)**:

```json
{ "success": true, "message": "Database connection successful.", "db": "8.0.x" }
```

- **Error (200)**:

```json
{ "success": false, "message": "Database connection failed.", "error": "..." }
```

---

### DB tables
- **Method**: GET  
- **Endpoint**: `/api/db-check/tables`  
- **Description**: Lists all tables in the current database.

#### Request
- **Headers**: none

#### Response
- **Success (200)**:

```json
{
  "success": true,
  "database": "food_delivery",
  "tables": [{ "tableName": "ACCOUNT", "tableRows": "123" }]
}
```

---

## Auth

### Register
- **Method**: POST  
- **Endpoint**: `/api/auth/register`  
- **Description**: Create an account using username/email/password.

#### Request
- **Headers**: `Content-Type: application/json`
- **Body (JSON sample)**:

```json
{
  "username": "demo",
  "email": "demo@example.com",
  "password": "Passw0rd!",
  "confirmPassword": "Passw0rd!"
}
```

#### Response
- **Success (201)**:

```json
{
  "success": true,
  "message": "signup.success.welcomeMessage",
  "account": {
    "id": "uuid",
    "username": "demo",
    "email": "demo@example.com",
    "role": "Customer",
    "status": "Active",
    "customer": null
  }
}
```

- **Error (400)**:

```json
{ "error": "signup.errors.validationFailed" }
```

---

### Login (email/password)
- **Method**: POST  
- **Endpoint**: `/api/auth/login`  
- **Description**: Login and receive an access token. Also sets `refresh_token` cookie.

#### Request
- **Headers**: `Content-Type: application/json`
- **Body (JSON sample)**:

```json
{ "username": "demo", "password": "Passw0rd!" }
```

#### Response
- **Success (200)**:

```json
{
  "success": true,
  "user": { "id": "uuid", "username": "demo", "email": "demo@example.com", "role": "Customer", "status": "Active" },
  "accessToken": "eyJ..."
}
```

- **Error (401/403)**:

```json
{ "error": "Incorrect password. Please check your password and try again." }
```

---

### Refresh access token
- **Method**: POST  
- **Endpoint**: `/api/auth/refresh`  
- **Description**: Rotate/issue a new access token using `refresh_token` cookie.

#### Request
- **Headers**:
  - `Content-Type: application/json` (optional)
  - Cookie: `refresh_token=<token>`
  - Optional: `x-account-id: <accountId>`

#### Response
- **Success (200)**:

```json
{ "accessToken": "eyJ..." }
```

- **Error (401)**:

```json
{ "error": "Unauthorized" }
```

---

### Logout
- **Method**: POST  
- **Endpoint**: `/api/auth/logout`  
- **Description**: Clears `refresh_token` cookie and revokes refresh tokens for the account (when possible).

#### Request
- **Headers**: Cookie `refresh_token=<token>` (optional)

#### Response
- **Success (200)**:

```json
{ "success": true }
```

---

### Get profile
- **Method**: GET  
- **Endpoint**: `/api/auth/profile`  
- **Description**: Returns the current account profile.

#### Request
- **Headers**: `Authorization: Bearer <accessToken>`

#### Response
- **Success (200)**:

```json
{
  "account": {
    "id": "uuid",
    "email": "demo@example.com",
    "username": "demo",
    "avatar": null,
    "status": "Active",
    "role": "Customer",
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-01-01T00:00:00.000Z"
  },
  "customer": null
}
```

---

### Upload avatar (multipart)
- **Method**: POST  
- **Endpoint**: `/api/auth/avatar`  
- **Description**: Uploads an avatar image to Cloudinary and updates the account avatar URL.

#### Request
- **Headers**:
  - `Authorization: Bearer <accessToken>`
  - `Content-Type: multipart/form-data`
- **Body**: form-data field `file` (JPEG/PNG/WEBP, max 3MB)

#### Response
- **Success (200)**:

```json
{ "success": true, "url": "https://..." }
```

---

### Google login (credential)
- **Method**: POST  
- **Endpoint**: `/api/auth/google`  
- **Description**: Login with Google ID token credential. Sets `refresh_token` cookie and returns access token.

#### Request
- **Headers**: `Content-Type: application/json`
- **Body (JSON sample)**:

```json
{ "credential": "<google_id_token>" }
```

#### Response
- **Success (200)**:

```json
{ "success": true, "user": { "id": "uuid", "role": "Customer" }, "accessToken": "eyJ..." }
```

---

### Google OAuth helper pages (optional)
- **Method**: GET  
- **Endpoint**: `/api/auth/google/authorize`  
- **Description**: Returns an HTML page to start the Google OAuth code flow.

---

- **Method**: GET  
- **Endpoint**: `/api/auth/google/callback`  
- **Description**: OAuth callback (HTML page posting a message back to frontend origin).

---

### Forgot password
- **Method**: POST  
- **Endpoint**: `/api/auth/forgot-password`  
- **Description**: Sends a reset code to email (if account exists).

#### Request
- **Headers**: `Content-Type: application/json`
- **Body (JSON sample)**:

```json
{ "email": "demo@example.com" }
```

#### Response
- **Success (200)**:

```json
{ "success": true, "message": "If an account with this email exists, a reset code has been sent." }
```

---

### Verify reset code
- **Method**: POST  
- **Endpoint**: `/api/auth/verify-reset-code`  
- **Description**: Verifies the reset code and returns a `tokenId`.

#### Request
- **Headers**: `Content-Type: application/json`
- **Body (JSON sample)**:

```json
{ "email": "demo@example.com", "code": "123456" }
```

#### Response
- **Success (200)**:

```json
{ "success": true, "message": "Reset code verified successfully", "tokenId": "uuid" }
```

---

### Resend reset code
- **Method**: POST  
- **Endpoint**: `/api/auth/resend-reset-code`  
- **Description**: Resends a reset code to email (rate-limited).

#### Request
- **Headers**: `Content-Type: application/json`
- **Body (JSON sample)**:

```json
{ "email": "demo@example.com" }
```

---

### Reset password
- **Method**: POST  
- **Endpoint**: `/api/auth/reset-password`  
- **Description**: Resets password using `tokenId` from verify step.

#### Request
- **Headers**: `Content-Type: application/json`
- **Body (JSON sample)**:

```json
{ "tokenId": "uuid", "newPassword": "NewPassw0rd!" }
```

---

### Change password (authenticated)
- **Method**: POST  
- **Endpoint**: `/api/auth/change-password`  
- **Description**: Changes current password (requires JWT).

#### Request
- **Headers**: `Authorization: Bearer <accessToken>`
- **Body (JSON sample)**:

```json
{ "currentPassword": "Passw0rd!", "newPassword": "NewPassw0rd!" }
```

---

## Customers

### Get customer by accountId
- **Method**: GET  
- **Endpoint**: `/api/customers/by-account?accountId=<uuid>`  
- **Description**: Returns customer profile for a given account id.

#### Response
- **Success (200)**:

```json
{ "customer": { "CustomerID": "uuid" } }
```

---

### Update customer profile
- **Method**: PUT  
- **Endpoint**: `/api/customers/update-profile`  
- **Description**: Updates the authenticated customer profile.

#### Request
- **Headers**: `Authorization: Bearer <accessToken>`
- **Body (JSON sample)**:

```json
{ "fullName": "Demo User", "phone": "0900000000", "address": "123 Street" }
```

#### Response
- **Success (200)**:

```json
{ "customer": { "CustomerID": "uuid", "FullName": "Demo User" } }
```

---

## Foods

### List foods
- **Method**: GET  
- **Endpoint**: `/api/foods`  
- **Description**: Lists foods with filters/pagination.

#### Request
- **Query params** (all optional):
  - `limit`, `page`
  - `restaurantId`
  - `category`
  - `search`
  - `isAvailable` (`true`/`false`)
  - `minPrice`, `maxPrice`

---

### Search foods (quick)
- **Method**: GET  
- **Endpoint**: `/api/foods/search?q=<keyword>&limit=20`  
- **Description**: Search foods by keyword.

---

### Popular foods
- **Method**: GET  
- **Endpoint**: `/api/foods/popular`  
- **Description**: Lists popular foods.

---

### Get foods by IDs
- **Method**: POST  
- **Endpoint**: `/api/foods/by-ids`  
- **Description**: Fetch foods by a list of IDs.

#### Request
- **Headers**: `Content-Type: application/json`
- **Body (JSON sample)**:

```json
{ "ids": ["uuid-1", "uuid-2"] }
```

---

## Restaurants

### List restaurants
- **Method**: GET  
- **Endpoint**: `/api/restaurants`  
- **Description**: Lists restaurants with search and filters.

#### Request
- **Query params** (optional): `page`, `limit`, `search`, `category`, `isOpen`, `minRating`

---

### Get restaurant by id
- **Method**: GET  
- **Endpoint**: `/api/restaurants/:id`  
- **Description**: Returns restaurant details.

---

### Get restaurant reviews
- **Method**: GET  
- **Endpoint**: `/api/restaurants/:id/reviews`  
- **Description**: Returns reviews for a restaurant.

#### Request
- **Query params** (optional): `sort` (`newest`/`oldest`), `page`, `limit`

---

### Get restaurant commission
- **Method**: GET  
- **Endpoint**: `/api/restaurants/:id/commission`  
- **Description**: Returns commission information for a restaurant.

---

### Create restaurant (authenticated)
- **Method**: POST  
- **Endpoint**: `/api/restaurants`  
- **Description**: Creates a restaurant (requires JWT).

#### Request
- **Headers**: `Authorization: Bearer <accessToken>`
- **Body (JSON sample)**:

```json
{
  "name": "My Restaurant",
  "description": "Best food",
  "address": "123 Street",
  "phone": "0900000000",
  "openHours": "08:00",
  "closeHours": "22:00",
  "isActive": true
}
```

---

### Update restaurant
- **Method**: PUT  
- **Endpoint**: `/api/restaurants/:id`  
- **Description**: Updates a restaurant.

---

### Delete restaurant
- **Method**: DELETE  
- **Endpoint**: `/api/restaurants/:id`  
- **Description**: Deletes a restaurant.

---

## Menu items

### List menu items
- **Method**: GET  
- **Endpoint**: `/api/menu-items`  
- **Description**: Lists menu items (query DTO is parsed by backend).

---

### Create menu item
- **Method**: POST  
- **Endpoint**: `/api/menu-items`  
- **Description**: Creates a menu item.

---

### Get menu item by id
- **Method**: GET  
- **Endpoint**: `/api/menu-items/:id`  
- **Description**: Returns menu item details.

---

### Update menu item
- **Method**: PUT  
- **Endpoint**: `/api/menu-items/:id`  
- **Description**: Updates a menu item.

---

### Delete menu item
- **Method**: DELETE  
- **Endpoint**: `/api/menu-items/:id`  
- **Description**: Deletes a menu item.

---

## Cart

### Get cart
- **Method**: GET  
- **Endpoint**: `/api/cart`  
- **Description**: Returns cart snapshot. Supports both authenticated users and guests.

#### Request
- **Headers** (optional):
  - `Authorization: Bearer <accessToken>` (customer)
  - `x-user-id: <accountId>` (legacy support)
  - Cookie: `guest_token=<token>` (guest cart)

#### Response
- **Success (200)**:

```json
{ "cartId": "uuid", "items": [] }
```

---

### Clear cart
- **Method**: DELETE  
- **Endpoint**: `/api/cart`  
- **Description**: Clears/abandons the active cart.

---

### Add item to cart
- **Method**: POST  
- **Endpoint**: `/api/cart/items`  
- **Description**: Adds or increments a cart item.

#### Request
- **Headers**: `Content-Type: application/json`
- **Body (JSON sample)**:

```json
{ "foodId": "uuid", "quantity": 2, "note": "No onion" }
```

---

### Update cart item quantity
- **Method**: PATCH  
- **Endpoint**: `/api/cart/items/:foodId`  
- **Description**: Sets item quantity. Use `0` to remove (behavior depends on service implementation).

#### Request
- **Headers**: `Content-Type: application/json`
- **Body (JSON sample)**:

```json
{ "quantity": 3 }
```

---

## Orders (authenticated)

### Create order
- **Method**: POST  
- **Endpoint**: `/api/orders`  
- **Description**: Creates an order for the authenticated customer.

#### Request
- **Headers**: `Authorization: Bearer <accessToken>`
- **Body (JSON sample)**:

```json
{
  "cartItems": [
    { "menuItem": { "id": "food-id", "price": 10.5 }, "quantity": 2 }
  ],
  "deliveryInfo": { "address": "123 Street" },
  "voucherCode": "DISCOUNT10",
  "paymentIntentId": "pi_..."
}
```

#### Response
- **Success (200)**:

```json
{ "orderId": "uuid", "total": 21.5 }
```

---

### List orders
- **Method**: GET  
- **Endpoint**: `/api/orders`  
- **Description**: Lists customer orders with filters/pagination.

#### Request
- **Headers**: `Authorization: Bearer <accessToken>`
- **Query params** (optional): `status`, `page`, `limit`, `startDate`, `endDate`

---

### Get order by id
- **Method**: GET  
- **Endpoint**: `/api/orders/:id`  
- **Description**: Gets order details for the authenticated customer.

---

### Cancel order
- **Method**: DELETE  
- **Endpoint**: `/api/orders/:id`  
- **Description**: Cancels an order (typically only `pending` is allowed).

---

### Track order
- **Method**: GET  
- **Endpoint**: `/api/orders/track/:id`  
- **Description**: Returns tracking info/status for an order.

---

### Reorder
- **Method**: POST  
- **Endpoint**: `/api/orders/:id/reorder`  
- **Description**: Recreates an order from an existing one (if allowed).

---

## Payments

### Create Stripe checkout session (authenticated)
- **Method**: POST  
- **Endpoint**: `/api/payments/create-checkout-session`  
- **Description**: Creates a Stripe Checkout session and returns the URL to redirect the user.

#### Request
- **Headers**: `Authorization: Bearer <accessToken>`
- **Body**: `CreateCheckoutSessionRequestDto` (see backend DTO in `src/modules/payments/dto`)

#### Response
- **Success (200)**:

```json
{ "url": "https://checkout.stripe.com/...", "sessionId": "cs_test_..." }
```

---

### Process checkout success (authenticated)
- **Method**: POST  
- **Endpoint**: `/api/payments/process-checkout-success`  
- **Description**: Confirms successful checkout for a session.

#### Request
- **Headers**: `Authorization: Bearer <accessToken>`
- **Body (JSON sample)**:

```json
{ "sessionId": "cs_test_..." }
```

---

### Store cart data (legacy / no auth)
- **Method**: POST  
- **Endpoint**: `/api/payments/store-cart-data`  
- **Description**: Logs cart snapshot for debugging/compatibility (no auth).

#### Request
- **Headers**: `Content-Type: application/json`
- **Body (JSON sample)**:

```json
{
  "sessionId": "cs_test_...",
  "cartItems": [],
  "deliveryInfo": { "phone": "0900000000", "address": "123 Street" },
  "voucherCode": "DISCOUNT10",
  "total": 100
}
```

#### Response
- **Success (200)**:

```json
{ "success": true }
```

---

### Stripe session status (authenticated)
- **Method**: GET  
- **Endpoint**: `/api/payments/stripe/session-status?sessionId=<id>`  
- **Description**: Returns checkout session status.

#### Request
- **Headers**: `Authorization: Bearer <accessToken>`

---

## Vouchers

### Validate voucher / list approved vouchers
- **Method**: GET  
- **Endpoint**: `/api/vouchers`  
- **Description**:
  - If `code` is provided: validates a voucher code.
  - Otherwise: returns a list of approved vouchers.

#### Request
- **Query params**:
  - `code` (optional)
  - `limit` (optional)

#### Response
- **Success (200)**:

```json
{ "success": true, "voucher": { "Code": "DISCOUNT10" } }
```

- **Error (200)**:

```json
{ "success": false, "error": "Invalid voucher" }
```

---

## Reviews

### Create review (multipart, authenticated)
- **Method**: POST  
- **Endpoint**: `/api/reviews`  
- **Description**: Creates a review; supports uploading up to 6 images.

#### Request
- **Headers**:
  - `Authorization: Bearer <accessToken>`
  - `Content-Type: multipart/form-data`
- **Body (form-data)**:
  - `enterpriseId` (string, required)
  - `rating` (string/int, optional)
  - `comment` (string, optional)
  - `images` (files, optional, up to 6)

---

### Enterprise reviews (authenticated)
- **Method**: GET  
- **Endpoint**: `/api/enterprise/reviews`  
- **Description**: Lists reviews for the authenticated enterprise account.

#### Request
- **Headers**: `Authorization: Bearer <accessToken>`
- **Query params** (optional): `q`, `rating`, `status`, `startDate`, `endDate`, `sort`, `page`, `limit`

---

### Hide/unhide an enterprise review (authenticated)
- **Method**: PATCH  
- **Endpoint**: `/api/enterprise/reviews/:id`  
- **Description**: Sets review visibility for the enterprise owner.

#### Request
- **Headers**: `Authorization: Bearer <accessToken>`
- **Body (JSON sample)**:

```json
{ "isHidden": true }
```

---

## Webhooks

### Stripe webhook
- **Method**: POST  
- **Endpoint**: `/api/webhooks/stripe`  
- **Description**: Stripe webhook receiver (requires `stripe-signature` and raw body).

#### Request
- **Headers**: `stripe-signature: <value>`
- **Body**: raw Stripe event payload (handled by Stripe)

#### Response
- **Success (200)**:

```json
{ "received": true }
```

---

## Health (AI)

### Gemini analyze
- **Method**: POST  
- **Endpoint**: `/api/health/gemini-analyze`  
- **Description**: Generates health analysis recommendations using Gemini API.

#### Request
- **Headers**: `Content-Type: application/json`
- **Body (JSON sample)**:

```json
{
  "age": 25,
  "gender": "male",
  "height": 175,
  "weight": 70,
  "activityLevel": "moderate",
  "healthGoal": "maintenance",
  "dietaryRestrictions": "no pork"
}
```

#### Response
- **Success (200)**:

```json
{ "success": true, "data": { "summary": "..." } }
```

- **Error (400)**:

```json
{ "statusCode": 400, "message": "Missing required fields", "error": "Bad Request" }
```

---

## Admin (requires AdminRoleGuard)

> These endpoints require a JWT **and** admin privileges.

### List customers (admin)
- **Method**: GET  
- **Endpoint**: `/api/admin/customers`  
- **Description**: Lists customers (cursor-based paging).

#### Request
- **Headers**: `Authorization: Bearer <accessToken>`
- **Query params** (optional): `status`, `search`, `limit`, `cursor`

---

### Lock / unlock customer (admin)
- **Method**: POST  
- **Endpoint**: `/api/admin/customers/:customerId/lock`  
- **Description**: Locks a customer.

---

- **Method**: POST  
- **Endpoint**: `/api/admin/customers/:customerId/unlock`  
- **Description**: Unlocks a customer.

---

### List enterprises (admin)
- **Method**: GET  
- **Endpoint**: `/api/admin/enterprises`  
- **Description**: Lists enterprise accounts.

---

### Create enterprise (admin)
- **Method**: POST  
- **Endpoint**: `/api/admin/enterprises`  
- **Description**: Creates an enterprise account.

---

### Lock / unlock enterprise account (admin)
- **Method**: POST  
- **Endpoint**: `/api/admin/enterprises/:accountId/lock`  
- **Description**: Locks an enterprise account.

---

- **Method**: POST  
- **Endpoint**: `/api/admin/enterprises/:accountId/unlock`  
- **Description**: Unlocks an enterprise account.

---

### Admin profile
- **Method**: GET  
- **Endpoint**: `/api/admin/profile`  
- **Description**: Returns the current admin profile.

---

### Admin reviews
- **Method**: GET  
- **Endpoint**: `/api/admin/reviews`  
- **Description**: Lists reviews for admin moderation.

---

### Patch review visibility (admin)
- **Method**: PATCH  
- **Endpoint**: `/api/admin/reviews/:id`  
- **Description**: Sets review visibility.

#### Request
- **Headers**: `Authorization: Bearer <accessToken>`
- **Body (JSON sample)**:

```json
{ "isHidden": true }
```

---

### Admin vouchers
- **Method**: GET  
- **Endpoint**: `/api/admin/vouchers`  
- **Description**: Lists vouchers.

---

### Create voucher (admin)
- **Method**: POST  
- **Endpoint**: `/api/admin/voucher`  
- **Description**: Creates a voucher.

---

### Approve voucher (admin)
- **Method**: PATCH  
- **Endpoint**: `/api/admin/vouchers/:voucherId/approve`  
- **Description**: Approves a voucher.

---

## 4. Status codes

- **200 OK**: request succeeded
- **201 Created**: resource created
- **204 No Content**: success with empty response (e.g. clear cart)
- **400 Bad Request**: invalid payload / validation error
- **401 Unauthorized**: missing/invalid token
- **403 Forbidden**: authenticated but not allowed (e.g. locked account / admin guard)
- **404 Not Found**: resource not found
- **429 Too Many Requests**: rate-limited (e.g. password reset)
- **500 Internal Server Error**: unexpected server error

## 5. Example API calls

### 5.1 Login (curl)

```bash
curl -X POST "http://localhost:3001/api/auth/login" ^
  -H "Content-Type: application/json" ^
  -d "{\"username\":\"demo\",\"password\":\"Passw0rd!\"}"
```

### 5.2 Get profile (fetch)

```js
const res = await fetch("http://localhost:3001/api/auth/profile", {
  headers: { Authorization: `Bearer ${accessToken}` },
});
const data = await res.json();
```

### 5.3 Add item to cart (fetch)

```js
const res = await fetch("http://localhost:3001/api/cart/items", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ foodId: "uuid", quantity: 2, note: "No onion" }),
});
const cart = await res.json();
```

### 5.4 Upload avatar (curl, multipart)

```bash
curl -X POST "http://localhost:3001/api/auth/avatar" ^
  -H "Authorization: Bearer <accessToken>" ^
  -F "file=@avatar.png"
```

