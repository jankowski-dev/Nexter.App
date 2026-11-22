-- AI universe membership rows are user-managed. Deleting a token entry only removes
-- the profile-token link; search history, artifacts, candles, bots and recommendations
-- have no foreign key to this table and are intentionally left untouched.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexter_app') THEN
    GRANT DELETE ON ai_profile_tokens TO nexter_app;
  END IF;
END $$;
