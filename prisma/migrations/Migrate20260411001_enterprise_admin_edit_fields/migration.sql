-- Admin edit enterprise: primary category + JSON business fields.

ALTER TABLE `ENTERPRISE`
  ADD COLUMN `PrimaryFoodCategoryID` VARCHAR(36) NULL,
  ADD COLUMN `AdminBusinessFields` JSON NULL;

CREATE INDEX `ENTERPRISE_PrimaryFoodCategoryID_idx` ON `ENTERPRISE`(`PrimaryFoodCategoryID`);

ALTER TABLE `ENTERPRISE`
  ADD CONSTRAINT `ENT_PrimaryFoodCategory_fkey`
  FOREIGN KEY (`PrimaryFoodCategoryID`) REFERENCES `FOOD_CATEGORY`(`CategoryID`)
  ON DELETE SET NULL ON UPDATE CASCADE;
