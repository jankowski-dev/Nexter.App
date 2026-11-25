-- Rename the owner's default watchlist group. Keep the existing name when a
-- custom group already uses "Избранное" so the unique (user_id, name) index
-- cannot break the migration; the UI treats the default group as Избранное in
-- that edge case only until the owner renames the custom group.
UPDATE "watchlist_groups" AS g
SET "name" = 'Избранное', "updated_at" = now()
WHERE g."is_default" = true
  AND g."name" = 'Основная'
  AND NOT EXISTS (
    SELECT 1
    FROM "watchlist_groups" AS x
    WHERE x."user_id" = g."user_id"
      AND x."name" = 'Избранное'
  );
