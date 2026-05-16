CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateTable
CREATE TABLE "copilot_chats" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'New chat',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "copilot_chats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "copilot_chats_user_id_updated_at_idx" ON "copilot_chats"("user_id", "updated_at");

-- AddForeignKey
ALTER TABLE "copilot_chats" ADD CONSTRAINT "copilot_chats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: one default chat per user who already has messages, then assign
-- their messages to that chat.
ALTER TABLE "copilot_messages" ADD COLUMN "chat_id" UUID;

INSERT INTO "copilot_chats" ("id", "user_id", "title", "created_at", "updated_at")
SELECT
    gen_random_uuid(),
    m."user_id",
    'Default',
    MIN(m."created_at"),
    NOW()
FROM "copilot_messages" m
GROUP BY m."user_id";

UPDATE "copilot_messages" m
SET "chat_id" = c."id"
FROM "copilot_chats" c
WHERE c."user_id" = m."user_id"
  AND c."title" = 'Default'
  AND m."chat_id" IS NULL;

ALTER TABLE "copilot_messages" ALTER COLUMN "chat_id" SET NOT NULL;

-- CreateIndex
CREATE INDEX "copilot_messages_chat_id_created_at_idx" ON "copilot_messages"("chat_id", "created_at");

-- AddForeignKey
ALTER TABLE "copilot_messages" ADD CONSTRAINT "copilot_messages_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "copilot_chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;
