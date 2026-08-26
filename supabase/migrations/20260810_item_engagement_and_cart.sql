create table if not exists public.item_likes (
  kind        text        not null check (kind in ('resource','blog','marketplace')),
  subject_id  uuid        not null,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (kind, subject_id, user_id)
);
create index if not exists item_likes_user_idx on public.item_likes (user_id, kind);
alter table public.item_likes enable row level security;

drop policy if exists item_likes_select_own on public.item_likes;
create policy item_likes_select_own on public.item_likes
  for select using (user_id = auth.uid());
drop policy if exists item_likes_insert_own on public.item_likes;
create policy item_likes_insert_own on public.item_likes
  for insert with check (user_id = auth.uid() and current_merit() > 40);
drop policy if exists item_likes_delete_own on public.item_likes;
create policy item_likes_delete_own on public.item_likes
  for delete using (user_id = auth.uid());

create table if not exists public.item_bookmarks (
  kind        text        not null check (kind in ('resource','blog','marketplace')),
  subject_id  uuid        not null,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (kind, subject_id, user_id)
);
create index if not exists item_bookmarks_user_idx on public.item_bookmarks (user_id, kind);
alter table public.item_bookmarks enable row level security;

drop policy if exists item_bookmarks_select_own on public.item_bookmarks;
create policy item_bookmarks_select_own on public.item_bookmarks
  for select using (user_id = auth.uid());
drop policy if exists item_bookmarks_insert_own on public.item_bookmarks;
create policy item_bookmarks_insert_own on public.item_bookmarks
  for insert with check (user_id = auth.uid() and current_merit() > 40);
drop policy if exists item_bookmarks_delete_own on public.item_bookmarks;
create policy item_bookmarks_delete_own on public.item_bookmarks
  for delete using (user_id = auth.uid());

create table if not exists public.cart_items (
  user_id     uuid        not null references auth.users(id) on delete cascade,
  item_id     uuid        not null references public.marketplace_items(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, item_id)
);
create index if not exists cart_items_user_idx on public.cart_items (user_id, created_at desc);
alter table public.cart_items enable row level security;

drop policy if exists cart_items_select_own on public.cart_items;
create policy cart_items_select_own on public.cart_items
  for select using (user_id = auth.uid());
drop policy if exists cart_items_insert_own on public.cart_items;
create policy cart_items_insert_own on public.cart_items
  for insert with check (user_id = auth.uid());
drop policy if exists cart_items_delete_own on public.cart_items;
create policy cart_items_delete_own on public.cart_items
  for delete using (user_id = auth.uid());

do $$
declare r record;
begin
  for r in
    select * from (values
      ('item_likes',     'INSERT', 'likes',          120, 300),
      ('item_bookmarks', 'INSERT', 'bookmarks',       60, 300),
      ('cart_items',     'INSERT', 'cart additions',  60, 300)
    ) as t(tbl, op, noun, max_n, win)
  loop
    if to_regclass('public.' || r.tbl) is null then continue; end if;
    execute format('drop trigger if exists dz_rate_%s_%s on public.%I',
                   lower(r.op), r.tbl, r.tbl);
    execute format(
      'create trigger dz_rate_%s_%s before %s on public.%I '||
      'for each row execute function public.dz_write_rate(%L, %L, %L)',
      lower(r.op), r.tbl, r.op, r.tbl, r.noun, r.max_n::text, r.win::text);
  end loop;
end $$;
