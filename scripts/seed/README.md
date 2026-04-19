# Seed scripts

Order is **important**. Run via `npm run db:seed`.

## Default seeded data

- Roles: `Admin`, `Customer`, `Enterprise`, `Support`, `Driver`
- Accounts (password: `Password123!`)
  - `admin@example.com` / `admin`
  - `customer@example.com` / `customer`
  - `enterprise@example.com` / `enterprise`
- Profiles:
  - Admin (RoleLevel=10)
  - Customer (Phone `0900000001`)
  - Enterprise (Phone `0900000002`)
- Catalog:
  - Food category: `Pizza`
  - Food: `Pepperoni Pizza` ($6)
  - Menu: `Main Menu` and menu-food linking

## Seed order

1. `01-roles.ts`
2. `02-accounts.ts`
3. `03-profiles.ts`
4. `04-catalog.ts`

