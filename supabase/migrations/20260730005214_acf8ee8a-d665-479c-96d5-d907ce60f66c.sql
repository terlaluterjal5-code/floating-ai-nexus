CREATE TABLE public.plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  price_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'IDR',
  billing_period text NOT NULL DEFAULT 'month',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.plans TO anon;
GRANT SELECT ON public.plans TO authenticated;
GRANT ALL ON public.plans TO service_role;
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Plans are publicly readable" ON public.plans FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.plan_features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  feature_key text NOT NULL,
  label text NOT NULL DEFAULT '',
  value_text text,
  value_number numeric,
  value_bool boolean,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, feature_key)
);
GRANT SELECT ON public.plan_features TO anon;
GRANT SELECT ON public.plan_features TO authenticated;
GRANT ALL ON public.plan_features TO service_role;
ALTER TABLE public.plan_features ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Plan features are publicly readable" ON public.plan_features FOR SELECT TO anon, authenticated USING (true);
CREATE INDEX plan_features_plan_id_idx ON public.plan_features(plan_id);

CREATE TABLE public.user_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.plans(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active',
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);
GRANT SELECT, INSERT, UPDATE ON public.user_subscriptions TO authenticated;
GRANT ALL ON public.user_subscriptions TO service_role;
ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own subscription" ON public.user_subscriptions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own subscription" ON public.user_subscriptions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own subscription" ON public.user_subscriptions FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX user_subscriptions_user_id_idx ON public.user_subscriptions(user_id);

CREATE TRIGGER plans_set_updated_at BEFORE UPDATE ON public.plans FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER plan_features_set_updated_at BEFORE UPDATE ON public.plan_features FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER user_subscriptions_set_updated_at BEFORE UPDATE ON public.user_subscriptions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.plans (code, name, price_cents, currency, billing_period, sort_order)
VALUES ('free', 'Free', 0, 'IDR', 'month', 0),
       ('premium', 'Premium', 20000000, 'IDR', 'month', 1);

INSERT INTO public.plan_features (plan_id, feature_key, label, value_bool, value_number, value_text)
SELECT p.id, f.feature_key, f.label, f.value_bool, f.value_number, f.value_text
FROM public.plans p
JOIN (VALUES
  ('free', 'chat', 'Chat access', true, NULL::numeric, NULL::text),
  ('free', 'daily_credits', 'Daily credits', NULL::boolean, 1000, NULL::text),
  ('free', 'deep_research', 'Deep Research mode', false, NULL::numeric, NULL::text),
  ('free', 'image_generation', 'AI image generation', true, NULL::numeric, NULL::text),
  ('free', 'pdf_max_mb', 'Max PDF size (MB)', NULL::boolean, 5, NULL::text),
  ('free', 'priority_processing', 'Priority AI processing', false, NULL::numeric, NULL::text),
  ('free', 'support', 'Support level', NULL::boolean, NULL::numeric, 'community'),
  ('premium', 'chat', 'Chat access', true, NULL::numeric, NULL::text),
  ('premium', 'daily_credits', 'Daily credits', NULL::boolean, NULL::numeric, 'unlimited'),
  ('premium', 'deep_research', 'Deep Research mode', true, NULL::numeric, NULL::text),
  ('premium', 'image_generation', 'AI image generation', true, NULL::numeric, NULL::text),
  ('premium', 'pdf_max_mb', 'Max PDF size (MB)', NULL::boolean, 100, NULL::text),
  ('premium', 'priority_processing', 'Priority AI processing', true, NULL::numeric, NULL::text),
  ('premium', 'support', 'Support level', NULL::boolean, NULL::numeric, 'priority')
) AS f(plan_code, feature_key, label, value_bool, value_number, value_text)
  ON f.plan_code = p.code;