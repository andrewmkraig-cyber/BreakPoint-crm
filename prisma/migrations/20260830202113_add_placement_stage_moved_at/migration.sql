-- Placement.stageMovedAt: when the row last actually CHANGED STAGE.
--
-- Before this, Days in Stage on /pipeline was computed from updatedAt, so
-- editing a fee, a note or a billing contact reset the clock to zero and
-- silenced the 7-day amber pill, the 14-day red pill and the Submitted
-- follow-up prompt. The RecruiterFlow rows in the same table already carried
-- a real stage_moved value, so the two halves of one screen disagreed.
--
-- Three steps below: add the column nullable, backfill it, then lock it down
-- and hand maintenance to a trigger.

-- 1. Add nullable so the backfill can choose each row's value. Adding it as
--    NOT NULL DEFAULT CURRENT_TIMESTAMP in one statement (what `migrate diff`
--    generates) would stamp every existing row with "right now" and throw away
--    the history we do have.
ALTER TABLE "Placement" ADD COLUMN "stageMovedAt" TIMESTAMP(3);

-- 2. Backfill from updatedAt. It is the wrong timestamp in principle, which is
--    the whole point of this migration, but it is the closest thing on the row
--    and it is what the pipeline was already showing, so no displayed number
--    changes for an existing placement on deploy. From here forward the column
--    diverges from updatedAt and becomes correct.
UPDATE "Placement" SET "stageMovedAt" = "updatedAt" WHERE "stageMovedAt" IS NULL;

-- 3. Lock it down. New rows start their clock at insert time.
ALTER TABLE "Placement" ALTER COLUMN "stageMovedAt" SET NOT NULL;
ALTER TABLE "Placement" ALTER COLUMN "stageMovedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- 4. Maintain it in the database rather than in application code.
--
--    There are 75 stage writes across 17 files. Stamping this column at each
--    one would be 75 chances to get it wrong today and a standing invitation
--    to forget it on the next path added. It also could not answer "did the
--    stage ACTUALLY change" without an extra read per write, so the idempotent
--    upserts (the P2002 catch in interview-actions, for instance, which
--    re-asserts a stage the row may already be at) would reset the clock and
--    reintroduce the exact bug.
--
--    IS DISTINCT FROM handles the no-op case exactly right, and covers every
--    write path including scripts and raw SQL. An UPDATE that sets
--    stageMovedAt WITHOUT touching stage passes straight through, so a data
--    correction script can still set it by hand.
CREATE OR REPLACE FUNCTION placement_stamp_stage_moved_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."stage" IS DISTINCT FROM OLD."stage" THEN
    NEW."stageMovedAt" := CURRENT_TIMESTAMP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS placement_stage_moved_at ON "Placement";

CREATE TRIGGER placement_stage_moved_at
BEFORE UPDATE ON "Placement"
FOR EACH ROW
EXECUTE FUNCTION placement_stamp_stage_moved_at();
