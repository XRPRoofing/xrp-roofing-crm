-- Storage bucket for crew job photos.
--
-- Photos used to be stored as base64 text directly in `job_photos.data_url`,
-- which made every board/folder read download megabytes of image data. They are
-- now uploaded as files to this Storage bucket and only the (small) public URL
-- is kept in `job_photos.data_url`.
--
-- Run this once in the Supabase SQL editor. It is idempotent and safe to re-run.
-- After running it, use scripts/migrate-photos-to-storage.mjs to move any
-- existing base64 photos into the bucket.

-- ---------------------------------------------------------------------------
-- Bucket: public read (so getPublicUrl works for galleries + customer shares),
-- writes restricted to authenticated CRM/crew users.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('job-photos', 'job-photos', true)
on conflict (id) do update set public = true;

-- ---------------------------------------------------------------------------
-- Object access policies for the job-photos bucket.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'job-photos public read'
  ) then
    create policy "job-photos public read" on storage.objects
      for select using (bucket_id = 'job-photos');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'job-photos authenticated write'
  ) then
    create policy "job-photos authenticated write" on storage.objects
      for all to authenticated
      using (bucket_id = 'job-photos')
      with check (bucket_id = 'job-photos');
  end if;
end;
$$;
