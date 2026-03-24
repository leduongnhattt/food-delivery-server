-- Core ETA location fields: enterprise coordinates + actual delivered timestamp.
ALTER TABLE `ENTERPRISE`
ADD COLUMN `Latitude` DECIMAL(10, 7) NULL,
ADD COLUMN `Longitude` DECIMAL(10, 7) NULL;

CREATE INDEX `ENTERPRISE_Latitude_Longitude_idx` ON `ENTERPRISE`(`Latitude`, `Longitude`);

ALTER TABLE `ORDER`
ADD COLUMN `DeliveredAt` DATETIME(3) NULL;

CREATE INDEX `ORDER_DeliveredAt_idx` ON `ORDER`(`DeliveredAt`);
