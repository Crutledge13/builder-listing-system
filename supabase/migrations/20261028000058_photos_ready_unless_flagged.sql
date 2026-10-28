-- A photo is OK for the MLS unless something was found wrong with it (an AI
-- warning: people, signs, text, too dark, blurry) or a person unticked it.
-- Before, every upload started as "not ready" and only the AI could clear it,
-- so with the AI off every photo showed "Not MLS-ready" and listings could be
-- held up for no reason. New uploads now start ready; this clears the ones
-- that were only waiting on a check that never ran.
update public.media
set mls_ready = true
where kind = 'photo' and deleted_at is null and not mls_ready
  and coalesce(jsonb_array_length(ai_suggestion -> 'flags'), 0) = 0;
