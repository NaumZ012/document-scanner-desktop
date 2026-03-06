-- Employee PIN support (server-side only)
-- - create_employee(name, pin): inserts employees row for auth.uid() with bcrypt hash
-- - verify_employee_pin(employee_id, pin): verifies pin for auth.uid() without exposing pin_hash

create extension if not exists pgcrypto;

create or replace function public.create_employee(p_name text, p_pin text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_id uuid;
begin
  v_owner := auth.uid();
  if v_owner is null then
    raise exception 'not authenticated';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'name required';
  end if;
  if p_pin is null or btrim(p_pin) = '' then
    raise exception 'pin required';
  end if;

  insert into public.employees (owner_id, name, pin_hash)
  values (v_owner, btrim(p_name), crypt(p_pin, gen_salt('bf', 10)))
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_employee(text, text) from public;
grant execute on function public.create_employee(text, text) to authenticated;

create or replace function public.verify_employee_pin(p_employee_id uuid, p_pin text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_hash text;
begin
  v_owner := auth.uid();
  if v_owner is null then
    raise exception 'not authenticated';
  end if;
  if p_employee_id is null then
    raise exception 'employee_id required';
  end if;
  if p_pin is null or btrim(p_pin) = '' then
    return false;
  end if;

  select e.pin_hash into v_hash
  from public.employees e
  where e.id = p_employee_id and e.owner_id = v_owner;

  if v_hash is null then
    return false;
  end if;

  return crypt(p_pin, v_hash) = v_hash;
end;
$$;

revoke all on function public.verify_employee_pin(uuid, text) from public;
grant execute on function public.verify_employee_pin(uuid, text) to authenticated;

