-- Add user_id to push_subscriptions so subscriptions are tied to agents
-- Each agent can have multiple devices; all will receive incoming call alerts.

ALTER TABLE public.push_subscriptions
  ADD COLUMN IF NOT EXISTS user_id UUID;

CREATE INDEX IF NOT EXISTS push_subscriptions_user_id_idx
  ON public.push_subscriptions (user_id);
