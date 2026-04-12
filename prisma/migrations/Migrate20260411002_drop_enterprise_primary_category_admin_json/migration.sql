-- Revert Migrate20260411001: primary category + AdminBusinessFields (not used).

ALTER TABLE `ENTERPRISE` DROP FOREIGN KEY `ENT_PrimaryFoodCategory_fkey`;

DROP INDEX `ENTERPRISE_PrimaryFoodCategoryID_idx` ON `ENTERPRISE`;

ALTER TABLE `ENTERPRISE`
  DROP COLUMN `PrimaryFoodCategoryID`,
  DROP COLUMN `AdminBusinessFields`;
