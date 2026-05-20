-- Fast cleanup for card tags JSONB:
-- 1) normalize cat tags ("cat:דף פ" -> "cat:פ'", "cat:עא" -> "cat:ע"א", "cat:פ." -> "cat:פ'")
-- 2) de-duplicate tags while preserving first appearance order
-- 3) remove redundant "cat:דף X" when normalized "cat:X'" exists

WITH elems AS (
  SELECT
    c.id,
    e.ord,
    e.tag,
    (e.tag LIKE 'cat:%') AS is_cat,
    CASE
      WHEN e.tag NOT LIKE 'cat:%' THEN e.tag
      ELSE (
        'cat:' ||
        CASE
          WHEN raw_name ~ '^ע"?[אב]$' THEN regexp_replace(raw_name, '^ע"?([אב])$', 'ע"\1')
          WHEN raw_name ~ '^ע[אב]''$' THEN regexp_replace(raw_name, '^ע([אב])''$', 'ע"\1')
          WHEN raw_name ~ '^[א-ת]{1,4}\.$' THEN replace(raw_name, '.', '''')
          ELSE raw_name
        END
      )
    END AS norm_tag,
    raw_name
  FROM cards c
  CROSS JOIN LATERAL (
    SELECT
      t.ord,
      t.tag,
      trim(regexp_replace(substr(t.tag, 5), '^דף\s+', '')) AS raw_name
    FROM jsonb_array_elements_text(c.tags) WITH ORDINALITY AS t(tag, ord)
  ) e
),
dedup AS (
  SELECT
    id,
    norm_tag AS tag,
    MIN(ord) AS first_ord
  FROM elems
  GROUP BY id, norm_tag
),
filtered AS (
  SELECT d.*
  FROM dedup d
  WHERE NOT (
    d.tag LIKE 'cat:דף %'
    AND EXISTS (
      SELECT 1
      FROM dedup d2
      WHERE d2.id = d.id
        AND d2.tag = ('cat:' || trim(regexp_replace(substr(d.tag, 5), '^דף\s+', '')))
    )
  )
),
rebuilt AS (
  SELECT
    id,
    to_jsonb(COALESCE(array_agg(tag ORDER BY first_ord, tag), ARRAY[]::text[])) AS new_tags
  FROM filtered
  GROUP BY id
),
updated AS (
  UPDATE cards c
  SET tags = r.new_tags
  FROM rebuilt r
  WHERE r.id = c.id
    AND c.tags IS DISTINCT FROM r.new_tags
  RETURNING c.id
)
SELECT COUNT(*) AS updated_cards FROM updated;
