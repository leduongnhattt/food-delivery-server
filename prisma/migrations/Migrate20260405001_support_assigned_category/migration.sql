-- AlterTable SUPPORT: category, assignment, activity timestamps
ALTER TABLE `SUPPORT` ADD COLUMN `Category` ENUM(
  'General',
  'ReviewModeration',
  'AccountShop',
  'MenuCatalog',
  'OrderOperations',
  'SettlementPayment',
  'Promotions',
  'Technical',
  'Order',
  'Delivery',
  'PaymentRefund',
  'Account',
  'ComplaintRestaurant'
) NOT NULL DEFAULT 'General';

ALTER TABLE `SUPPORT` ADD COLUMN `AssignedAdminID` VARCHAR(36) NULL;
ALTER TABLE `SUPPORT` ADD COLUMN `AssignedAt` DATETIME(3) NULL;
ALTER TABLE `SUPPORT` ADD COLUMN `UpdatedAt` DATETIME(3) NULL;
ALTER TABLE `SUPPORT` ADD COLUMN `LastActivityAt` DATETIME(3) NULL;

CREATE INDEX `SUPPORT_Category_idx` ON `SUPPORT`(`Category`);
CREATE INDEX `SUPPORT_AssignedAdminID_idx` ON `SUPPORT`(`AssignedAdminID`);

ALTER TABLE `SUPPORT` ADD CONSTRAINT `SUPPORT_AssignedAdminID_fkey` FOREIGN KEY (`AssignedAdminID`) REFERENCES `ADMIN`(`AdminID`) ON DELETE SET NULL ON UPDATE CASCADE;
