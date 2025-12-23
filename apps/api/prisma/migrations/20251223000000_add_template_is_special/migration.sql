-- Add a flag to mark templates that use the "special" background + single-subject flow.
ALTER TABLE "Template" ADD COLUMN "isSpecial" BOOLEAN NOT NULL DEFAULT false;


