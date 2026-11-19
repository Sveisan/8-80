ALTER TABLE "callers" ADD COLUMN "web_skip_undo" jsonb;
--> statement-breakpoint
-- A skip may replace the receipt itself. Other schedule writers invalidate it,
-- including when another change later returns the schedule to the same time.
CREATE FUNCTION clear_weekly_skip_undo() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.web_skip_undo := NULL;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER callers_clear_weekly_skip_undo
BEFORE UPDATE OF next_call_at, next_call_cycle, slot_weekday, slot_minute, timezone ON callers
FOR EACH ROW WHEN (
  OLD.web_skip_undo IS NOT NULL
  AND OLD.web_skip_undo IS NOT DISTINCT FROM NEW.web_skip_undo
  AND (OLD.next_call_at, OLD.next_call_cycle, OLD.slot_weekday, OLD.slot_minute, OLD.timezone)
    IS DISTINCT FROM (NEW.next_call_at, NEW.next_call_cycle, NEW.slot_weekday, NEW.slot_minute, NEW.timezone)
)
EXECUTE FUNCTION clear_weekly_skip_undo();
