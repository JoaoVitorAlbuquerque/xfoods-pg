-- CreateEnum
CREATE TYPE "order_type" AS ENUM ('WAITING', 'IN_PRODUCTION', 'DONE');

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "table" INTEGER NOT NULL,
    "status" "order_type" NOT NULL DEFAULT 'WAITING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "restarted" BOOLEAN NOT NULL DEFAULT false,
    "paid" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);
