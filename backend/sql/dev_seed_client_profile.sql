-- Dev seed: sample client profile used for local testing
-- Run this after supabase_schema.sql

insert into public.client_profiles (
    client_code,
    client_name,
    brand_voice_rules,
    words_to_avoid,
    required_disclaimers,
    preferred_tone,
    common_audiences,
    default_approver,
    subscription_tier,
    credit_menu,
    turnaround_rules,
    compliance_notes,
    service_options
)
values (
    'READYONE01',
    'ReadyOne Industries',
    'Direct, confident, workforce-centered. Avoid corporate fluff.',
    '["empowerment journey","disruption"]'::jsonb,
    'EOE employer statement required on recruitment materials.',
    'confident and straightforward',
    '["job seekers","employers","internal staff"]'::jsonb,
    'Lupita R.',
    'Tier 2',
    '{"custom_graphic":25,"newsletter_internal":75,"newsletter_external":90,"press_release":90,"campaign_set":85}'::jsonb,
    'Urgent requests should include business impact in notes.',
    'Use EOE disclaimer where required.',
    '["Campaign set (up to 6 assets)","Custom graphic","Moderate layout graphic","Internal newsletter (up to 3 pages)","External newsletter (up to 3 pages)","Press release","Press release package","Other"]'::jsonb
)
on conflict (client_code) do update set
    client_name = excluded.client_name,
    brand_voice_rules = excluded.brand_voice_rules,
    words_to_avoid = excluded.words_to_avoid,
    required_disclaimers = excluded.required_disclaimers,
    preferred_tone = excluded.preferred_tone,
    common_audiences = excluded.common_audiences,
    default_approver = excluded.default_approver,
    subscription_tier = excluded.subscription_tier,
    credit_menu = excluded.credit_menu,
    turnaround_rules = excluded.turnaround_rules,
    compliance_notes = excluded.compliance_notes,
    service_options = excluded.service_options,
    updated_at = now();
