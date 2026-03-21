-- AlterTable: widen SUPPORT.Description for long ticket bodies (no FK/index changes).
ALTER TABLE `SUPPORT` MODIFY COLUMN `Description` TEXT NULL;
