DELETE FROM public.plan_features;

INSERT INTO public.plan_features (plan_id, feature_key, label, value_bool)
SELECT p.id, f.feature_key, f.label, (p.code <> 'free')
FROM public.plans p
CROSS JOIN (VALUES
  ('unlimited_deep_research', 'Unlimited Deep Research mode'),
  ('higher_ai_intelligence', 'Higher AI intelligence level'),
  ('faster_response_speed', 'Faster response speed'),
  ('advanced_image_generation', 'Advanced AI image generation'),
  ('larger_pdf_analysis', 'Larger PDF analysis capability'),
  ('priority_processing', 'Priority AI processing'),
  ('exclusive_futuristic_ai_tools', 'Exclusive futuristic AI tools'),
  ('professional_research_assistant', 'Professional research assistant'),
  ('unlimited_chat_credits', 'Unlimited chat credits'),
  ('advanced_data_analysis', 'Advanced data analysis')
) AS f(feature_key, label);