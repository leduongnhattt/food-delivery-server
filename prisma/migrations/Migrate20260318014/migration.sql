-- Append-only audit trail. Optional FK to ACCOUNT only (SetNull on account delete); no FK to business tables.
CREATE TABLE `AUDIT_LOG` (
    `AuditLogID` VARCHAR(36) NOT NULL,
    `CreatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `ActorAccountID` VARCHAR(36) NULL,
    `Action` VARCHAR(120) NOT NULL,
    `EntityType` VARCHAR(80) NULL,
    `EntityId` VARCHAR(36) NULL,
    `Summary` VARCHAR(500) NOT NULL,
    `Metadata` JSON NULL,
    `IpAddress` VARCHAR(45) NULL,
    `Success` BOOLEAN NOT NULL DEFAULT true,

    INDEX `AUDIT_LOG_CreatedAt_idx`(`CreatedAt`),
    INDEX `AUDIT_LOG_ActorAccountID_idx`(`ActorAccountID`),
    INDEX `AUDIT_LOG_Action_idx`(`Action`),
    INDEX `AUDIT_LOG_EntityType_EntityId_idx`(`EntityType`, `EntityId`),
    PRIMARY KEY (`AuditLogID`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `AUDIT_LOG`
ADD CONSTRAINT `AUDIT_LOG_ActorAccountID_fkey`
FOREIGN KEY (`ActorAccountID`) REFERENCES `ACCOUNT`(`AccountID`) ON DELETE SET NULL ON UPDATE CASCADE;
