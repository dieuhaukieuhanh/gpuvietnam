-- Storage bucket cho model KH upload (chạy trên Supabase SQL Editor)

insert into storage.buckets (id, name, public, file_size_limit)
values ('user-models', 'user-models', true, 524288000)
on conflict (id) do update set public = excluded.public;

create policy "Users upload own model files"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'user-models'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users read own model files"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'user-models'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users delete own model files"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'user-models'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
