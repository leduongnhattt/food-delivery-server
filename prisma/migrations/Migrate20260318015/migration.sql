-- Enterprise payout: 2 tables only — wide destination row (bank OR e-wallet) + schedule settings.
CREATE TABLE `ENTERPRISE_PAYOUT_DESTINATION` (
    `PayoutDestinationID` VARCHAR(36) NOT NULL,
    `EnterpriseID` VARCHAR(36) NOT NULL,
    `Kind` ENUM('BankAccount', 'EWallet') NOT NULL,
    `Label` VARCHAR(100) NULL,
    `IsDefault` BOOLEAN NOT NULL DEFAULT false,
    `IsActive` BOOLEAN NOT NULL DEFAULT true,
    `VerifiedAt` DATETIME(3) NULL,
    `CreatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `UpdatedAt` DATETIME(3) NULL,

    `BankName` VARCHAR(120) NULL,
    `BankCode` VARCHAR(32) NULL,
    `AccountHolderName` VARCHAR(120) NULL,
    `AccountNumber` VARCHAR(34) NULL,
    `BranchName` VARCHAR(120) NULL,
    `CountryCode` VARCHAR(2) NULL,

    `ProviderCode` VARCHAR(50) NULL,
    `WalletRef` VARCHAR(120) NULL,
    `WalletDisplayName` VARCHAR(120) NULL,

    `DetailMetadata` JSON NULL,

    INDEX `ENTERPRISE_PAYOUT_DESTINATION_EnterpriseID_idx`(`EnterpriseID`),
    INDEX `ENTERPRISE_PAYOUT_DESTINATION_EnterpriseID_IsActive_idx`(`EnterpriseID`, `IsActive`),
    INDEX `ENTERPRISE_PAYOUT_DESTINATION_Kind_idx`(`Kind`),
    INDEX `ENTERPRISE_PAYOUT_DESTINATION_ProviderCode_idx`(`ProviderCode`),
    PRIMARY KEY (`PayoutDestinationID`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ENTERPRISE_PAYOUT_DESTINATION`
ADD CONSTRAINT `ENTERPRISE_PAYOUT_DESTINATION_EnterpriseID_fkey`
FOREIGN KEY (`EnterpriseID`) REFERENCES `ENTERPRISE`(`EnterpriseID`) ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE `ENTERPRISE_PAYOUT_SETTINGS` (
    `EnterpriseID` VARCHAR(36) NOT NULL,
    `PayoutFrequency` ENUM('Monthly', 'Quarterly', 'Yearly') NOT NULL DEFAULT 'Monthly',
    `PreferredPayoutDestinationID` VARCHAR(36) NULL,
    `EffectiveFrom` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `UpdatedAt` DATETIME(3) NULL,

    UNIQUE INDEX `ENTERPRISE_PAYOUT_SETTINGS_PreferredPayoutDestinationID_key`(`PreferredPayoutDestinationID`),
    PRIMARY KEY (`EnterpriseID`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ENTERPRISE_PAYOUT_SETTINGS`
ADD CONSTRAINT `ENTERPRISE_PAYOUT_SETTINGS_EnterpriseID_fkey`
FOREIGN KEY (`EnterpriseID`) REFERENCES `ENTERPRISE`(`EnterpriseID`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ENTERPRISE_PAYOUT_SETTINGS`
ADD CONSTRAINT `ENTERPRISE_PAYOUT_SETTINGS_PreferredPayoutDestinationID_fkey`
FOREIGN KEY (`PreferredPayoutDestinationID`) REFERENCES `ENTERPRISE_PAYOUT_DESTINATION`(`PayoutDestinationID`) ON DELETE SET NULL ON UPDATE CASCADE;
