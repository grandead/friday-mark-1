CREATE TYPE "HomeDeviceKind" AS ENUM ('humidifier', 'airMonitor', 'breezer');
CREATE TYPE "DeviceRegistrationType" AS ENUM ('miioToken', 'hommynShareUrl');

CREATE TABLE "homes" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "displayName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "homes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "homes_uuidv7" CHECK (uuid_extract_version("id") IS NOT DISTINCT FROM 7),
    CONSTRAINT "homes_name_nonempty" CHECK (length(btrim("displayName")) > 0)
);

CREATE TABLE "rooms" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "homeId" UUID NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "rooms_uuidv7" CHECK (uuid_extract_version("id") IS NOT DISTINCT FROM 7),
    CONSTRAINT "rooms_name_nonempty" CHECK (length(btrim("displayName")) > 0),
    CONSTRAINT "rooms_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "homes"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "homeDeviceTypes" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "code" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "kind" "HomeDeviceKind" NOT NULL,
    "registrationType" "DeviceRegistrationType" NOT NULL,
    CONSTRAINT "homeDeviceTypes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "homeDeviceTypes_uuidv7" CHECK (uuid_extract_version("id") IS NOT DISTINCT FROM 7)
);

CREATE TABLE "homeDevices" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "roomId" UUID NOT NULL,
    "typeId" UUID NOT NULL,
    "displayName" TEXT NOT NULL,
    "registrationData" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "homeDevices_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "homeDevices_uuidv7" CHECK (uuid_extract_version("id") IS NOT DISTINCT FROM 7),
    CONSTRAINT "homeDevices_name_nonempty" CHECK (length(btrim("displayName")) > 0),
    CONSTRAINT "homeDevices_registration_object" CHECK (jsonb_typeof("registrationData") = 'object'),
    CONSTRAINT "homeDevices_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "homeDevices_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "homeDeviceTypes"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "rooms_homeId_idx" ON "rooms"("homeId");
CREATE UNIQUE INDEX "homeDeviceTypes_code_key" ON "homeDeviceTypes"("code");
CREATE INDEX "homeDevices_roomId_idx" ON "homeDevices"("roomId");
CREATE INDEX "homeDevices_typeId_idx" ON "homeDevices"("typeId");

-- Catalogue entries describe registration forms, not verified device connections.
-- Exact hardware identifiers for Qingping and Smartmi will be checked on connection.
INSERT INTO "homeDeviceTypes" ("code", "displayName", "vendor", "model", "kind", "registrationType") VALUES
    ('xiaomi-smart-humidifier-2', 'Xiaomi Smart Humidifier 2', 'Xiaomi', 'Smart Humidifier 2', 'humidifier', 'miioToken'),
    ('qingping-air-monitor-lite', 'Qingping Air Monitor Lite', 'Qingping', 'Air Monitor Lite', 'airMonitor', 'miioToken'),
    ('smartmi-fresh-air', 'Xiaomi Smartmi Fresh Air', 'Smartmi', 'Fresh Air', 'breezer', 'miioToken'),
    ('ballu-oneair-asp-100', 'Ballu ONEAIR ASP-100', 'Ballu', 'ONEAIR ASP-100', 'breezer', 'hommynShareUrl');
