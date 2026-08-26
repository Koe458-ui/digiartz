create or replace function public.dz_client_ip()
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_raw text;
  v_hdr json;
  v_ip  text;
begin
  v_raw := nullif(current_setting('request.headers', true), '');
  if v_raw is null then
    return null;
  end if;

  begin
    v_hdr := v_raw::json;
  exception when others then
    return null;
  end;

  v_ip := coalesce(
    nullif(btrim(coalesce(v_hdr ->> 'cf-connecting-ip', '')), ''),
    nullif(btrim(coalesce(v_hdr ->> 'true-client-ip',  '')), ''),
    nullif(btrim(coalesce(v_hdr ->> 'x-real-ip',       '')), ''),
    nullif(btrim(split_part(coalesce(v_hdr ->> 'x-forwarded-for', ''), ',', 1)), '')
  );

  return left(v_ip, 64);
end
$$;

revoke all on function public.dz_client_ip() from public;
revoke all on function public.dz_client_ip() from anon;
revoke all on function public.dz_client_ip() from authenticated;
