-- Supabase schema for Bianomics intake MVP

create table if not exists public.client_profiles (
    client_code text primary key,
    client_name text not null,
    brand_voice_rules text not null,
    words_to_avoid jsonb not null default '[]'::jsonb,
    required_disclaimers text,
    preferred_tone text,
    common_audiences jsonb not null default '[]'::jsonb,
    default_approver text,
    subscription_tier text,
    credit_menu jsonb not null default '{}'::jsonb,
    turnaround_rules text,
    compliance_notes text,
    service_options jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.service_options (
    scope text primary key,
    options jsonb not null default '[]'::jsonb,
    updated_at timestamptz not null default now()
);

create table if not exists public.request_logs (
    id uuid primary key default gen_random_uuid(),
    client_code text not null,
    client_name text not null,
    service_type text not null,
    project_title text not null,
    summary text not null,
    payload jsonb not null,
    monday_item_id text,
    created_at timestamptz not null default now()
);

create table if not exists public.client_login_events (
    id uuid primary key default gen_random_uuid(),
    client_code text not null,
    client_name text not null,
    login_source text not null default 'chat',
    remote_addr text,
    created_at timestamptz not null default now()
);

create table if not exists public.admin_notifications (
    id uuid primary key default gen_random_uuid(),
    client_code text not null,
    client_name text not null,
    title text not null,
    message text not null,
    notification_type text not null default 'profile_update',
    is_read boolean not null default false,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists idx_request_logs_client_code on public.request_logs(client_code);
create index if not exists idx_request_logs_created_at on public.request_logs(created_at desc);
create index if not exists idx_client_login_events_client_code on public.client_login_events(client_code);
create index if not exists idx_client_login_events_created_at on public.client_login_events(created_at desc);
create index if not exists idx_admin_notifications_created_at on public.admin_notifications(created_at desc);
create index if not exists idx_admin_notifications_is_read on public.admin_notifications(is_read);

insert into public.service_options(scope, options)
values (
    'global',
    '["Campaign set (up to 6 assets)","Custom graphic","Moderate layout graphic","Internal newsletter (up to 3 pages)","External newsletter (up to 3 pages)","Press release","Press release package","Other"]'::jsonb
)
on conflict (scope) do nothing;
