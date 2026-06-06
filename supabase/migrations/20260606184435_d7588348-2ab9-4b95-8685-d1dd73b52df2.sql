UPDATE public.notification_dispatch_config
SET hmac_secret = encode(extensions.gen_random_bytes(32), 'hex'),
    updated_at = now()
WHERE id = 1;