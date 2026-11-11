-- Fix Auth Identities for GoTrue compatibility
INSERT INTO auth.identities (
  id,
  user_id,
  identity_data,
  provider,
  provider_id,
  last_sign_in_at,
  created_at,
  updated_at
)
SELECT 
  gen_random_uuid(),
  id,
  json_build_object('sub', id::text, 'email', email)::jsonb,
  'email',
  id::text,
  now(),
  now(),
  now()
FROM auth.users
ON CONFLICT (provider, provider_id) DO NOTHING;

UPDATE auth.users 
SET email_confirmed_at = COALESCE(email_confirmed_at, now())
WHERE email IN ('basim@ourteam.io', 'alishah@ourteam.io', 'moiz@ourteam.io');
