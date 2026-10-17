-- Privat, tidsbegraenset fejlfinding. Ingen klient kan laese rapporter.
create schema if not exists norstream_diagnostics;
revoke all on schema norstream_diagnostics from public, anon, authenticated;
grant usage on schema norstream_diagnostics to service_role;
create table norstream_diagnostics.sessions (
 id uuid primary key default gen_random_uuid(),
 support_code text generated always as (upper(substr(replace(id::text,'-',''),1,12))) stored unique,
 activation_hash text not null unique check (activation_hash ~ '^[a-f0-9]{64}$'),
 activate_before timestamptz not null default now()+interval '2 days',
 claim_id text,
 token_hash text unique,
 expires_at timestamptz,
 last_upload_at timestamptz,
 created_at timestamptz not null default now()
);
create index ns_diagnostics_sessions_expiry on norstream_diagnostics.sessions (expires_at);
create table norstream_diagnostics.reports (
 id uuid primary key,
 session_id uuid not null references norstream_diagnostics.sessions(id) on delete cascade,
 received_at timestamptz not null default now(),
 payload jsonb not null check (octet_length(payload::text)<=32768)
);
create index ns_diagnostics_reports_session_time on norstream_diagnostics.reports (session_id,received_at desc);
create table norstream_diagnostics.claim_limit (
 singleton boolean primary key default true check(singleton), minute timestamptz not null, attempts integer not null
);
alter table norstream_diagnostics.sessions enable row level security;
alter table norstream_diagnostics.reports enable row level security;
alter table norstream_diagnostics.claim_limit enable row level security;
revoke all on all tables in schema norstream_diagnostics from public,anon,authenticated;
grant all on all tables in schema norstream_diagnostics to service_role;

create table norstream_diagnostics.enrolment (
 singleton boolean primary key default true check(singleton),
 closes_at timestamptz not null, capacity integer not null check(capacity between 1 and 1000), created_count integer not null default 0
);
alter table norstream_diagnostics.enrolment enable row level security;
revoke all on norstream_diagnostics.enrolment from public,anon,authenticated;
grant all on norstream_diagnostics.enrolment to service_role;
insert into norstream_diagnostics.enrolment(singleton,closes_at,capacity) values(true,now()+interval '14 days',100);
create or replace function public.ns_diagnostic_enrol(p_token_hash text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s norstream_diagnostics.sessions; gate norstream_diagnostics.enrolment; attempts integer;
begin
 if p_token_hash !~ '^[a-f0-9]{64}$' then return '{"status":"invalid"}'; end if;
 insert into norstream_diagnostics.claim_limit as l(singleton,minute,attempts)
 values(true,date_trunc('minute',now()),1)
 on conflict(singleton) do update set minute=excluded.minute,
 attempts=case when l.minute=excluded.minute then least(l.attempts+1,121) else 1 end returning l.attempts into attempts;
 if attempts>120 then return '{"status":"limited"}'; end if;
 select * into gate from norstream_diagnostics.enrolment where singleton=true for update;
 if not found or gate.closes_at<=now() or gate.created_count>=gate.capacity then return '{"status":"closed"}'; end if;
 insert into norstream_diagnostics.sessions(activation_hash,claim_id,token_hash,expires_at)
 values(p_token_hash,'automatic',p_token_hash,now()+interval '7 days') returning * into s;
 update norstream_diagnostics.enrolment set created_count=created_count+1 where singleton=true;
 return jsonb_build_object('status','ok','supportCode',s.support_code,'expiresAt',s.expires_at);
end $$;
create or replace function public.ns_diagnostic_upload(p_token_hash text,p_report_id uuid,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s norstream_diagnostics.sessions;
begin
 select * into s from norstream_diagnostics.sessions where token_hash=p_token_hash for update;
 if not found then return '{"status":"invalid"}'; end if;
 if s.expires_at<=now() then return '{"status":"expired"}'; end if;
 if exists(select 1 from norstream_diagnostics.reports where id=p_report_id and session_id=s.id) then return '{"status":"ok"}'; end if;
 if s.last_upload_at>now()-interval '55 seconds' then return '{"status":"limited"}'; end if;
 if jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>32768 then return '{"status":"invalid"}'; end if;
 insert into norstream_diagnostics.reports(id,session_id,payload) values(p_report_id,s.id,p_payload);
 update norstream_diagnostics.sessions set last_upload_at=now() where id=s.id;
 -- Behold 120 normale og 30 fejlrapporter. Fejl bevares hele sessionen.
 delete from norstream_diagnostics.reports where session_id=s.id and id in (
 (select id from norstream_diagnostics.reports where session_id=s.id and payload->>'kind'<>'failure' order by received_at desc offset 120)
 union all
 (select id from norstream_diagnostics.reports where session_id=s.id and payload->>'kind'='failure' order by received_at desc offset 30));
 return '{"status":"ok"}';
end $$;
revoke all on function public.ns_diagnostic_enrol(text) from public,anon,authenticated;
revoke all on function public.ns_diagnostic_upload(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.ns_diagnostic_enrol(text) to service_role;
grant execute on function public.ns_diagnostic_upload(text,uuid,jsonb) to service_role;
-- Slet udloebne rapporter/sessioner. Sky-backup beroeres ikke.
select cron.schedule('norstream-diagnostics-retention','17 * * * *',
 $$delete from norstream_diagnostics.sessions where expires_at<now() or (claim_id is null and activate_before<now());$$);
create or replace function public.ns_diagnostic_stop(p_token_hash text)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 update norstream_diagnostics.sessions set expires_at=now() where token_hash=p_token_hash;
 return jsonb_build_object('status',case when found then 'ok' else 'invalid' end);
end $$;
revoke all on function public.ns_diagnostic_stop(text) from public,anon,authenticated;
grant execute on function public.ns_diagnostic_stop(text) to service_role;
