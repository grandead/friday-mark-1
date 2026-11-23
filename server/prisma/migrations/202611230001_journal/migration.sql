-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "displayName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "displayName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(3),

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interactions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "deviceId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(3),
    "status" TEXT NOT NULL,
    "inputAudioKey" TEXT NOT NULL,
    "transcript" TEXT,
    "responseText" TEXT,
    "responseSource" TEXT,
    "outputAudioKey" TEXT,
    "error" TEXT,

    CONSTRAINT "interactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interactionActions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "interactionId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "initiator" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "arguments" JSONB NOT NULL,
    "result" JSONB,
    "error" TEXT,

    CONSTRAINT "interactionActions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "interactions_inputAudioKey_key" ON "interactions"("inputAudioKey");

-- CreateIndex
CREATE INDEX "interactions_deviceId_startedAt_idx" ON "interactions"("deviceId", "startedAt");

-- CreateIndex
CREATE INDEX "interactions_userId_startedAt_idx" ON "interactions"("userId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "interactionActions_interactionId_sequence_key" ON "interactionActions"("interactionId", "sequence");

-- AddForeignKey
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interactionActions" ADD CONSTRAINT "interactionActions_interactionId_fkey" FOREIGN KEY ("interactionId") REFERENCES "interactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- UUID is the storage type. Enforce version 7 for explicit IDs as well.
ALTER TABLE "devices" ADD CHECK (uuid_extract_version(id) IS NOT DISTINCT FROM 7);
ALTER TABLE "users" ADD CHECK (uuid_extract_version(id) IS NOT DISTINCT FROM 7);
ALTER TABLE "interactions" ADD CHECK (uuid_extract_version(id) IS NOT DISTINCT FROM 7);
ALTER TABLE "interactionActions" ADD CHECK (uuid_extract_version(id) IS NOT DISTINCT FROM 7);

INSERT INTO "devices" ("id", "displayName") VALUES ('01a20858-a582-724b-950b-855d0dfa5bec', 'Пятница');
INSERT INTO "users" ("id", "displayName") VALUES ('01a20858-a582-7fa5-b8a6-a8b5bccf8b4a', 'Кирилл');
