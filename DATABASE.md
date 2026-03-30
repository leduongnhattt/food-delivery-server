# Food Delivery Server – Database (MySQL)

This document describes the database schema for `food-delivery-server` as defined in `prisma/schema.prisma`.

## 1. Database overview

- **Database**: MySQL
- **ORM**: Prisma
- **Connection**: `DATABASE_URL` (see `.env.example`)
- **Naming**
  - Prisma models are mapped to physical MySQL tables via `@@map("...")`.
  - Column names follow the Prisma field names (e.g. `AccountID`, `CreatedAt`).

## 2. Tables

> Types below follow Prisma’s MySQL mapping (e.g. `@db.VarChar(36)`, `@db.Decimal(18, 2)`, `DateTime`, `Json`, etc.).

### Table: ROLE

| Field | Type | Description |
|------|------|------------|
| RoleID | varchar(36) | Primary key (UUID) |
| RoleName | varchar(50) | Unique role name |
| Description | varchar(255) \| null | Optional description |
| Permissions | json \| null | Optional permissions payload |
| IsActive | boolean | Active flag |
| CreatedAt | datetime | Created timestamp |
| UpdatedAt | datetime \| null | Updated timestamp |

### Table: ACCOUNT

| Field | Type | Description |
|------|------|------------|
| AccountID | varchar(36) | Primary key (UUID) |
| Email | varchar(100) | Unique email |
| Username | varchar(255) | Unique username |
| PasswordHash | varchar(255) \| null | Hashed password (email login) |
| Avatar | varchar(255) \| null | Avatar URL |
| RoleID | varchar(36) | FK → `ROLE.RoleID` |
| Locale | varchar(10) \| null | Locale preference |
| Currency | varchar(3) \| null | Currency preference |
| Status | enum(AccountStatus) | Account status |
| CreatedAt | datetime | Created timestamp |
| UpdatedAt | datetime \| null | Updated timestamp |
| LastLogin | datetime \| null | Last login time |
| Provider | varchar(50) \| null | Auth provider (e.g. `google`) |
| ProviderAccountId | varchar(255) \| null | Provider subject id |
| EmailVerified | boolean | Email verified flag |

### Table: CUSTOMER

| Field | Type | Description |
|------|------|------------|
| CustomerID | varchar(36) | Primary key (UUID) |
| FullName | varchar(100) | Customer full name |
| PhoneNumber | varchar(15) | Unique phone number |
| Address | varchar(255) | Default address |
| DateOfBirth | datetime \| null | DOB |
| Gender | enum(Gender) \| null | Gender |
| PreferredPaymentMethod | enum(PaymentMethod) | Preferred payment method |
| AccountID | varchar(36) | Unique FK → `ACCOUNT.AccountID` (1–1) |

### Table: ENTERPRISE

| Field | Type | Description |
|------|------|------------|
| EnterpriseID | varchar(36) | Primary key (UUID) |
| AccountID | varchar(36) | Unique FK → `ACCOUNT.AccountID` (1–1) |
| EnterpriseName | varchar(100) | Restaurant/business name |
| Address | varchar(255) | Address |
| Latitude | decimal(10,7) \| null | Latitude |
| Longitude | decimal(10,7) \| null | Longitude |
| Description | varchar(255) \| null | Description |
| PhoneNumber | varchar(15) | Unique phone |
| OpenHours | varchar(10) | Open time |
| CloseHours | varchar(10) | Close time |
| IsActive | boolean | Active flag |
| CreatedAt | datetime | Created timestamp |
| UpdatedAt | datetime \| null | Updated timestamp |
| DeletedAt | datetime \| null | Soft delete timestamp |
| CommissionRate | decimal(5,2) \| null | Commission rate |
| SettlementCycle | enum(SettlementCycle) \| null | Settlement cycle |

### Table: ADMIN

| Field | Type | Description |
|------|------|------------|
| AdminID | varchar(36) | Primary key (UUID) |
| AccountID | varchar(36) | Unique FK → `ACCOUNT.AccountID` (1–1) |
| CanManageSystem | boolean | Permission flag |
| CanViewReport | boolean | Permission flag |
| RoleLevel | int | Admin level |

### Table: FOOD_CATEGORY

| Field | Type | Description |
|------|------|------------|
| CategoryID | varchar(36) | Primary key (UUID) |
| CategoryName | varchar(50) | Unique category name |
| Description | varchar(255) \| null | Optional description |
| CreatedAt | datetime | Created timestamp |
| UpdatedAt | datetime \| null | Updated timestamp |
| AdminID | varchar(36) | FK → `ADMIN.AdminID` |

### Table: FOOD

| Field | Type | Description |
|------|------|------------|
| FoodID | varchar(36) | Primary key (UUID) |
| DishName | varchar(100) | Dish name |
| Price | decimal(18,2) | Price |
| Stock | int | Stock count |
| Description | varchar(255) \| null | Description |
| ImageURL | varchar(255) \| null | Image URL |
| FoodCategoryID | varchar(36) | FK → `FOOD_CATEGORY.CategoryID` |
| EnterpriseID | varchar(36) | FK → `ENTERPRISE.EnterpriseID` |
| IsAvailable | boolean | Availability flag |
| CreatedAt | datetime | Created timestamp |
| UpdatedAt | datetime \| null | Updated timestamp |

### Table: MENU

| Field | Type | Description |
|------|------|------------|
| MenuID | varchar(36) | Primary key (UUID) |
| EnterpriseID | varchar(36) | FK → `ENTERPRISE.EnterpriseID` |
| Description | varchar(100) \| null | Description |
| MenuName | varchar(100) | Menu name |
| CreatedAt | datetime | Created timestamp |
| UpdatedAt | datetime \| null | Updated timestamp |

### Table: MENU_FOOD

| Field | Type | Description |
|------|------|------------|
| FoodID | varchar(36) | PK (composite) + FK → `FOOD.FoodID` |
| MenuID | varchar(36) | PK (composite) + FK → `MENU.MenuID` |

### Table: VOUCHER

| Field | Type | Description |
|------|------|------------|
| VoucherID | varchar(36) | Primary key (UUID) |
| EnterpriseID | varchar(36) \| null | FK → `ENTERPRISE.EnterpriseID` (nullable) |
| AdminID | varchar(36) \| null | FK → `ADMIN.AdminID` (nullable) |
| Code | varchar(100) | Unique voucher code |
| DiscountPercent | decimal(5,2) \| null | Percent discount |
| DiscountAmount | decimal(10,2) \| null | Fixed discount |
| CreatedBy | enum(VoucherCreatedBy) \| null | Created by (admin/business) |
| CreatedAt | datetime | Created timestamp |
| UpdatedAt | datetime \| null | Updated timestamp |
| Status | enum(VoucherStatus) | Pending/Approved/Rejected |
| ExpiryDate | datetime \| null | Expiry date |
| MaxUsage | int \| null | Max usage count |
| UsedCount | int | Used count |
| MinOrderValue | decimal(10,2) \| null | Minimum order total |

### Table: ORDER

| Field | Type | Description |
|------|------|------------|
| OrderID | varchar(36) | Primary key (UUID) |
| CustomerID | varchar(36) | FK → `CUSTOMER.CustomerID` |
| VoucherID | varchar(36) \| null | FK → `VOUCHER.VoucherID` |
| TotalAmount | decimal(18,2) | Order total |
| OrderDate | datetime | Created time |
| DeliveryAddress | text | Delivery address |
| DeliveryNote | text \| null | Delivery note |
| EstimatedDeliveryTime | datetime \| null | ETA |
| DeliveredAt | datetime \| null | Delivered time |
| Status | enum(OrderStatus) | Order status |
| CommissionAmount | decimal(18,2) \| null | Platform commission amount |
| Metadata | json \| null | Extra metadata |

### Table: ORDER_DETAIL

| Field | Type | Description |
|------|------|------------|
| OrderDetailID | varchar(36) | Primary key (UUID) |
| OrderID | varchar(36) | FK → `ORDER.OrderID` |
| FoodID | varchar(36) | FK → `FOOD.FoodID` |
| SubTotal | decimal(18,2) | Line subtotal |
| Quantity | int | Quantity |
| AppliedCommissionPercent | decimal(5,2) \| null | Commission percent snapshot |
| CommissionLineAmount | decimal(18,2) \| null | Commission amount snapshot |
| Metadata | json \| null | Extra metadata |

### Table: CART

| Field | Type | Description |
|------|------|------------|
| CartID | varchar(36) | Primary key (UUID) |
| CustomerID | varchar(36) \| null | FK → `CUSTOMER.CustomerID` (nullable for guest) |
| EnterpriseID | varchar(36) \| null | FK → `ENTERPRISE.EnterpriseID` |
| GuestToken | varchar(64) \| null | Unique guest token (cookie-based) |
| Status | enum(CartStatus) | Active/CheckedOut/Abandoned |
| ExpiresAt | datetime \| null | Expiry time |
| CreatedAt | datetime | Created timestamp |
| UpdatedAt | datetime \| null | Updated timestamp |

### Table: CART_ITEM

| Field | Type | Description |
|------|------|------------|
| CartItemID | varchar(36) | Primary key (UUID) |
| CartID | varchar(36) | FK → `CART.CartID` |
| FoodID | varchar(36) | FK → `FOOD.FoodID` |
| Quantity | int | Quantity |
| Note | varchar(255) \| null | Optional note |
| Price | decimal(18,2) | Unit price snapshot |
| CreatedAt | datetime | Created timestamp |
| UpdatedAt | datetime \| null | Updated timestamp |

### Table: DELIVERY_DRIVER

| Field | Type | Description |
|------|------|------------|
| DriverID | varchar(36) | Primary key (UUID) |
| AccountID | varchar(36) | Unique FK → `ACCOUNT.AccountID` |
| FullName | varchar(100) | Driver name |
| PhoneNumber | varchar(15) | Unique phone |
| VehicleType | varchar(50) \| null | Vehicle type |
| Status | enum(DriverStatus) | Driver status |
| CurrentLat | decimal(10,7) \| null | Current latitude |
| CurrentLng | decimal(10,7) \| null | Current longitude |
| LastActiveAt | datetime \| null | Last activity |
| CreatedAt | datetime | Created timestamp |
| UpdatedAt | datetime \| null | Updated timestamp |

### Table: PAYMENT

| Field | Type | Description |
|------|------|------------|
| PaymentID | varchar(36) | Primary key (UUID) |
| OrderID | varchar(36) | FK → `ORDER.OrderID` |
| PaymentDate | datetime | Payment created time |
| PaymentStatus | enum(PaymentStatus) | Pending/Completed/Failed |
| TransactionID | varchar(255) \| null | Unique transaction id |
| PaymentMethod | enum(PaymentMethod) | Cash/CreditCard/MoMo/BankTransfer |
| TransactionData | json \| null | Gateway payload |

### Table: SETTLEMENT

| Field | Type | Description |
|------|------|------------|
| SettlementID | varchar(36) | Primary key (UUID) |
| EnterpriseID | varchar(36) | FK → `ENTERPRISE.EnterpriseID` |
| PeriodStart | datetime | Settlement period start |
| PeriodEnd | datetime | Settlement period end |
| NetPayout | decimal(18,2) \| null | Net payout |
| Status | enum(SettlementStatus) | Pending/Processing/Completed/Failed |
| PaidAt | datetime \| null | Paid time |
| TransactionID | varchar(255) \| null | Payout transaction id |
| CreatedAt | datetime | Created timestamp |

### Table: SETTLEMENT_ITEM

| Field | Type | Description |
|------|------|------------|
| SettlementItemID | varchar(36) | Primary key (UUID) |
| SettlementID | varchar(36) | FK → `SETTLEMENT.SettlementID` |
| OrderID | varchar(36) | FK → `ORDER.OrderID` |
| IsCOD | boolean | Cash-on-delivery flag |

### Table: PLATFORM_COMMISSION_DEFAULT

| Field | Type | Description |
|------|------|------------|
| DefaultID | varchar(36) | Primary key (fixed UUID) |
| CommissionPercent | decimal(5,2) | Default commission percent |
| UpdatedAt | datetime \| null | Updated timestamp |
| UpdatedByAdminID | varchar(36) \| null | FK → `ADMIN.AdminID` |

### Table: CATEGORY_COMMISSION_DEFAULT

| Field | Type | Description |
|------|------|------------|
| CommissionDefaultID | varchar(36) | Primary key (UUID) |
| FoodCategoryID | varchar(36) | FK → `FOOD_CATEGORY.CategoryID` |
| CommissionPercent | decimal(5,2) | Commission percent |
| IsActive | boolean | Active flag |
| EffectiveFrom | datetime | Effective start |
| EffectiveTo | datetime \| null | Effective end |
| UpdatedAt | datetime \| null | Updated timestamp |
| UpdatedByAdminID | varchar(36) \| null | FK → `ADMIN.AdminID` |

### Table: DEDUCTION_RULE

| Field | Type | Description |
|------|------|------------|
| RuleID | varchar(36) | Primary key (UUID) |
| EnterpriseID | varchar(36) \| null | FK → `ENTERPRISE.EnterpriseID` (null = global rule) |
| DeductionType | enum(DeductionType) | Type of deduction |
| Label | varchar(255) | Rule label |
| FixedAmount | decimal(18,2) \| null | Fixed amount |
| PercentOfGross | decimal(5,2) \| null | Percent amount |
| IsActive | boolean | Active flag |
| ValidFrom | datetime | Valid start |
| ValidTo | datetime \| null | Valid end |
| CreatedAt | datetime | Created timestamp |
| UpdatedAt | datetime \| null | Updated timestamp |
| CreatedByAdminID | varchar(36) \| null | FK → `ADMIN.AdminID` |

### Table: SETTLEMENT_DEDUCTION

| Field | Type | Description |
|------|------|------------|
| DeductionID | varchar(36) | Primary key (UUID) |
| SettlementID | varchar(36) | FK → `SETTLEMENT.SettlementID` |
| Amount | decimal(18,2) | Deduction amount |
| DeductionType | enum(DeductionType) | Deduction type |
| Reason | text \| null | Reason |
| ReferenceCode | varchar(100) \| null | Reference code |
| DeductionRuleID | varchar(36) \| null | FK → `DEDUCTION_RULE.RuleID` |
| CreatedAt | datetime | Created timestamp |
| CreatedByAdminID | varchar(36) \| null | FK → `ADMIN.AdminID` |

### Table: AUDIT_LOG

| Field | Type | Description |
|------|------|------------|
| AuditLogID | varchar(36) | Primary key (UUID) |
| CreatedAt | datetime | Created timestamp |
| ActorAccountID | varchar(36) \| null | FK → `ACCOUNT.AccountID` |
| Action | varchar(120) | Action name |
| EntityType | varchar(80) \| null | Entity type |
| EntityId | varchar(36) \| null | Entity id |
| Summary | varchar(500) | Human-readable summary |
| Metadata | json \| null | Extra metadata |
| IpAddress | varchar(45) \| null | IP address |
| Success | boolean | Success flag |

### Table: SUPPORT

| Field | Type | Description |
|------|------|------------|
| MessageID | varchar(36) | Primary key (UUID) |
| AccountID | varchar(36) | FK → `ACCOUNT.AccountID` |
| Subject | varchar(255) | Subject |
| Description | text \| null | Description |
| SentAt | datetime | Sent time |
| Status | enum(SupportStatus) | Support status |
| ReplyMessage | text \| null | Reply message |

### Table: REVIEWS

| Field | Type | Description |
|------|------|------------|
| ReviewID | varchar(36) | Primary key (UUID) |
| CustomerID | varchar(36) | FK → `CUSTOMER.CustomerID` |
| EnterpriseID | varchar(36) | FK → `ENTERPRISE.EnterpriseID` |
| Rating | tinyint \| null | Rating |
| Comment | varchar(100) \| null | Comment |
| CreatedAt | datetime | Created timestamp |
| UpdatedAt | datetime \| null | Updated timestamp |
| Images | json \| null | Image list/metadata |
| IsHidden | boolean | Visibility flag |

### Table: USER_HEALTH

| Field | Type | Description |
|------|------|------------|
| HealthID | varchar(36) | Primary key (UUID) |
| CustomerID | varchar(36) | FK → `CUSTOMER.CustomerID` |
| CreatedAt | datetime | Created timestamp |
| Age | int \| null | Age |
| Gender | enum(Gender) \| null | Gender |
| Height | decimal(8,2) \| null | Height (cm) |
| Weight | decimal(8,2) \| null | Weight (kg) |
| Goal | varchar(100) \| null | Health goal |
| MedicalConditions | json \| null | Conditions |
| PreferredCuisine | json \| null | Cuisine preferences |
| UpdatedAt | datetime \| null | Updated timestamp |

### Table: AUTH_TOKEN

| Field | Type | Description |
|------|------|------------|
| TokenID | varchar(36) | Primary key (UUID) |
| AccountID | varchar(36) | FK → `ACCOUNT.AccountID` |
| RefreshToken | varchar(255) | Unique refresh token |
| AccessToken | varchar(255) \| null | Optional access token snapshot |
| CreatedAt | datetime | Created timestamp |
| ExpiredAt | datetime | Expiration |
| RevokedAt | datetime \| null | Revocation time |
| IsValid | boolean | Valid flag |

### Table: PASSWORD_RESET_TOKEN

| Field | Type | Description |
|------|------|------------|
| TokenID | varchar(36) | Primary key (UUID) |
| AccountID | varchar(36) | FK → `ACCOUNT.AccountID` |
| ResetCode | varchar(6) | Reset code |
| ExpiresAt | datetime | Expiration |
| IsUsed | boolean | Used flag |
| CreatedAt | datetime | Created timestamp |

### Table: ENTERPRISE_PAYOUT_DESTINATION

| Field | Type | Description |
|------|------|------------|
| PayoutDestinationID | varchar(36) | Primary key (UUID) |
| EnterpriseID | varchar(36) | FK → `ENTERPRISE.EnterpriseID` |
| Kind | enum(PayoutDestinationKind) | BankAccount/EWallet |
| Label | varchar(100) \| null | Display label |
| IsDefault | boolean | Default destination flag |
| IsActive | boolean | Active flag |
| VerifiedAt | datetime \| null | Verified time |
| CreatedAt | datetime | Created timestamp |
| UpdatedAt | datetime \| null | Updated timestamp |
| BankName | varchar(120) \| null | Bank name |
| BankCode | varchar(32) \| null | Bank code |
| AccountHolderName | varchar(120) \| null | Account holder |
| AccountNumber | varchar(34) \| null | Account number |
| BranchName | varchar(120) \| null | Branch name |
| CountryCode | varchar(2) \| null | Country code |
| ProviderCode | varchar(50) \| null | Provider code |
| WalletRef | varchar(120) \| null | Wallet reference |
| WalletDisplayName | varchar(120) \| null | Wallet display name |
| DetailMetadata | json \| null | Extra details |

### Table: ENTERPRISE_PAYOUT_SETTINGS

| Field | Type | Description |
|------|------|------------|
| EnterpriseID | varchar(36) | Primary key + FK → `ENTERPRISE.EnterpriseID` |
| PayoutFrequency | enum(PayoutFrequency) | Monthly/Quarterly/Yearly |
| PreferredPayoutDestinationID | varchar(36) \| null | Unique FK → `ENTERPRISE_PAYOUT_DESTINATION.PayoutDestinationID` |
| EffectiveFrom | datetime | Effective start |
| UpdatedAt | datetime \| null | Updated timestamp |

## 3. Relationships between tables

### 3.1 One-to-one (1–1)

- `ACCOUNT` ↔ `CUSTOMER` (via `CUSTOMER.AccountID` unique)
- `ACCOUNT` ↔ `ENTERPRISE` (via `ENTERPRISE.AccountID` unique)
- `ACCOUNT` ↔ `ADMIN` (via `ADMIN.AccountID` unique)
- `ACCOUNT` ↔ `DELIVERY_DRIVER` (via `DELIVERY_DRIVER.AccountID` unique)
- `ENTERPRISE` ↔ `ENTERPRISE_PAYOUT_SETTINGS` (via `EnterpriseID` primary key)

### 3.2 One-to-many (1–n)

- `ROLE` → `ACCOUNT`
- `CUSTOMER` → `ORDER`
- `CUSTOMER` → `CART`
- `ORDER` → `ORDER_DETAIL`
- `ORDER` → `PAYMENT`
- `CART` → `CART_ITEM`
- `ENTERPRISE` → `FOOD`, `MENU`, `VOUCHER`, `REVIEWS`, `SETTLEMENT`
- `ACCOUNT` → `AUTH_TOKEN`, `PASSWORD_RESET_TOKEN`, `SUPPORT`, `AUDIT_LOG`

### 3.3 Many-to-many (n–n)

- `MENU` ↔ `FOOD` via `MENU_FOOD` (composite PK: `FoodID + MenuID`)

## 4. Indexes & optimization

Notable indexes defined in Prisma (see `@@index`, `@@unique`, and `@@fulltext`):

- **ACCOUNT**
  - Indexes: `RoleID`, `Locale`, `Currency`, `Status`, `CreatedAt`, `Provider`, `ProviderAccountId`, `EmailVerified`
- **ENTERPRISE**
  - Indexes: `AccountID`, `EnterpriseName`, `(Latitude, Longitude)`, `DeletedAt`
  - Fulltext: `(EnterpriseName, Description)`
- **FOOD**
  - Indexes: `FoodCategoryID`, `EnterpriseID`, `Price`, `DishName`
  - Composite: `(FoodCategoryID, IsAvailable, Price)`, `(EnterpriseID, IsAvailable)`
  - Fulltext: `(DishName, Description)`
- **VOUCHER**
  - Unique: `Code`
  - Indexes: `Status`, `ExpiryDate`, `EnterpriseID`, `AdminID`, `CreatedAt`
- **ORDER**
  - Indexes: `VoucherID`, `Status`, `OrderDate`, `DeliveredAt`, `TotalAmount`
  - Composite: `(CustomerID, Status)`, `(Status, OrderDate)`, `(CustomerID, OrderDate)`
- **ORDER_DETAIL**
  - Unique: `(OrderID, FoodID)`
  - Indexes: `OrderID`, `FoodID`
- **CART**
  - Unique: `GuestToken`
  - Indexes: `CustomerID`, `EnterpriseID`, `ExpiresAt`
- **CART_ITEM**
  - Unique: `(CartID, FoodID)`
  - Indexes: `CartID`, `FoodID`
- **PAYMENT**
  - Unique: `TransactionID`
  - Indexes: `OrderID`, `PaymentStatus`, `PaymentDate`
- **REVIEWS**
  - Indexes: `CustomerID`, `EnterpriseID`, `Rating`, `CreatedAt`, `IsHidden`

## 5. Migrations

- Prisma migrations live under `prisma/migrations/*`.
- Common commands (from `package.json`):
  - `npm run db:generate` (generate Prisma client)
  - `npm run db:migrate` (apply migrations in dev)
  - `npm run db:push` (push schema changes without migrations; use carefully)
  - `npm run db:studio` (open Prisma Studio)

