-- Add ENTERPRISE_NOTIFICATION for enterprise in-app notifications (e.g. new order).

CREATE TABLE `ENTERPRISE_NOTIFICATION` (
  `NotificationID` VARCHAR(36) NOT NULL,
  `EnterpriseID` VARCHAR(36) NOT NULL,
  `Type` ENUM('ORDER_CREATED') NOT NULL,
  `Title` VARCHAR(255) NOT NULL,
  `Body` TEXT NULL,
  `Data` JSON NULL,
  `ReadAt` DATETIME(3) NULL,
  `CreatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `EventID` VARCHAR(36) NOT NULL,
  PRIMARY KEY (`NotificationID`),
  UNIQUE INDEX `ENTERPRISE_NOTIFICATION_EventID_key` (`EventID`),
  INDEX `ENT_NOTI_ent_created_idx` (`EnterpriseID`, `CreatedAt`),
  INDEX `ENT_NOTI_ent_read_idx` (`EnterpriseID`, `ReadAt`),
  CONSTRAINT `ENTERPRISE_NOTIFICATION_EnterpriseID_fkey` FOREIGN KEY (`EnterpriseID`) REFERENCES `ENTERPRISE`(`EnterpriseID`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

