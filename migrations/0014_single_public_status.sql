-- The Cloud edition publishes statically only. Every public page becomes
-- 'public_static', shown in the admin screen simply as public.
UPDATE posts SET status='public_static',data=json_set(data,'$.status','public_static') WHERE status IN ('public','public_dynamic');
