-- Add ITIL extension fields to Ticket model
-- Add ItilCategory enum
-- Add ClosureCode enum

-- Create itil_category enum
CREATE TYPE "ItilCategory" AS ENUM (
  'INCIDENT',
  'SERVICE_REQUEST',
  'PROBLEM',
  'CHANGE',
  'ACCESS_REQUEST'
);

-- Create closure_code enum
CREATE TYPE "ClosureCode" AS ENUM (
  'RESOLVED_SUCCESSFULLY',
  'WORKAROUND_PROVIDED',
  'DUPLICATE',
  'NOT_A_BUG',
  'CANCELLED',
  'WONT_FIX'
);

-- Add ITIL columns to Ticket table
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "itilCategory" "ItilCategory" NOT NULL DEFAULT 'SERVICE_REQUEST';
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "impact" INTEGER;
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "urgency" INTEGER;
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "priorityCalc" INTEGER;
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "ciName" TEXT;
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "closureCode" "ClosureCode";
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "firstResponse" TIMESTAMP(3);
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "slaDeadline" TIMESTAMP(3);
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "slaBreached" BOOLEAN NOT NULL DEFAULT false;
