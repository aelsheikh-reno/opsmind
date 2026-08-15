-- BusinessCalendar."timeZone" — the IANA zone whose CIVIL date is "today" in a
-- jurisdiction ("Asia/Dubai", "Africa/Cairo").
--
-- Three steps, ONE migration. A migration is atomic, so either the column
-- arrives populated and NOT NULL or it does not arrive at all. Splitting these
-- into separate migrations would leave a window in which the column exists and
-- is nullable, and a row written in that window carries no zone at all.
--
-- WHY THE COLUMN HAS NO DEFAULT.
-- A default would make every step below succeed on any database, which is
-- exactly the problem. The deadline sweep runs at 02:00, which in the Gulf is
-- 22:00 the PREVIOUS UTC day: a calendar carrying a zone nobody chose computes
-- "today" on the wrong civil day and warns a day late, silently, for every
-- deadline in that jurisdiction. A default is that defect written down once and
-- then trusted by everything downstream. So the column is filled from a map
-- stated here in full, and a row the map cannot answer for stops the migration.
--
-- WHY AN UNMAPPED JURISDICTION ABORTS RATHER THAN GUESSING.
-- There is no safe fallback. UTC is wrong by four hours for the Gulf and by two
-- for Egypt, and the neighbouring country's zone is wrong whenever the two
-- differ. Guessing produces a calendar that looks configured and is not
-- (CLAUDE.md rule 8). The RAISE below names the offending jurisdiction codes so
-- whoever deploys this reads what to add to the map, instead of a NOT NULL
-- violation that names a column and explains nothing.

-- 1 · Add the column nullable, so an existing table can be backfilled at all.
--     ALTER TABLE ... ADD COLUMN ... NOT NULL with no default fails outright on
--     any table that already holds rows.
ALTER TABLE "BusinessCalendar" ADD COLUMN "timeZone" TEXT;

-- 2 · Backfill from an explicit map, keyed on Jurisdiction.code, which
--     prisma/schema.prisma documents as ISO 3166-1 alpha-2. The five countries
--     this build serves, written out rather than derived: a zone is a decision
--     about a country, not something to be computed from one.
UPDATE "BusinessCalendar" AS c
SET "timeZone" = m.zone
FROM "Jurisdiction" AS j
JOIN (VALUES
        ('AE', 'Asia/Dubai'),
        ('EG', 'Africa/Cairo'),
        ('SA', 'Asia/Riyadh'),
        ('KW', 'Asia/Kuwait'),
        ('BH', 'Asia/Bahrain')
     ) AS m(code, zone) ON m.code = j.code
WHERE c."jurisdictionId" = j.id
  AND c."timeZone" IS NULL;

-- 3 · Abort, loudly and by name, on anything the map did not answer for.
--     The LEFT JOIN is deliberate: a calendar whose "jurisdictionId" matches no
--     Jurisdiction row is reported here as an orphan rather than dropped from
--     the check by an inner join and then failing opaquely at SET NOT NULL.
DO $migration$
DECLARE
  unmapped TEXT;
BEGIN
  SELECT string_agg(DISTINCT label, ', ' ORDER BY label)
    INTO unmapped
    FROM (
      SELECT COALESCE(j.code, 'no Jurisdiction row for id ' || c."jurisdictionId") AS label
        FROM "BusinessCalendar" AS c
        LEFT JOIN "Jurisdiction" AS j ON j.id = c."jurisdictionId"
       WHERE c."timeZone" IS NULL
    ) AS missing;

  IF unmapped IS NOT NULL THEN
    RAISE EXCEPTION
      'BusinessCalendar rows remain without a timeZone: this migration has no IANA zone mapped for %', unmapped
      USING HINT = 'Add the jurisdiction and its IANA zone to the map in this migration. Never guess a zone: a wrong one computes every deadline on the wrong civil day.';
  END IF;
END
$migration$;

-- On an empty database steps 2 and 3 are no-ops and this still runs, so the
-- column ends NOT NULL there exactly as it does on a populated one.
ALTER TABLE "BusinessCalendar" ALTER COLUMN "timeZone" SET NOT NULL;
