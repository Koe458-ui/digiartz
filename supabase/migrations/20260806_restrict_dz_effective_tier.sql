-- dz_effective_tier(p_user) is SECURITY DEFINER, took an arbitrary p_user and
-- applied no check, so any visitor -- signed in or not -- could ask for any
-- account's subscription tier and learn who is paying. Minor next to the
-- dz_reconcile leak, but it is the same shape: a definer function handed a user
-- id it never verifies the caller is entitled to ask about.
--
-- Nothing in the browser calls it. js/gallery.js:440 uses dz_download_quota(),
-- which reports the caller's OWN tier and stays granted. The two in-database
-- callers, dz_request_download() and dz_download_quota(), are themselves
-- SECURITY DEFINER owned by postgres, so their internal calls resolve against
-- the definer and are unaffected by this revoke.
revoke execute on function public.dz_effective_tier(uuid) from anon;
revoke execute on function public.dz_effective_tier(uuid) from authenticated;
