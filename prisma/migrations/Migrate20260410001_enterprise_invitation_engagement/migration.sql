-- Track enterprise invitation email opens and activation link clicks for admin timeline & stats.

CREATE TABLE `ENTERPRISE_INVITATION_ENGAGEMENT_EVENT` (
  `EventID` VARCHAR(36) NOT NULL,
  `InvitationID` VARCHAR(36) NOT NULL,
  `Type` ENUM('EmailOpen', 'LinkClick') NOT NULL,
  `OccurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`EventID`),
  INDEX `EIENG_evt_inv_occ_idx` (`InvitationID`, `OccurredAt`),
  CONSTRAINT `ENTERPRISE_INVITATION_ENGAGEMENT_EVENT_InvitationID_fkey` FOREIGN KEY (`InvitationID`) REFERENCES `ENTERPRISE_INVITATION`(`InvitationID`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
