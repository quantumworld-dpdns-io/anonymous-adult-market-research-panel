-- supabase/storage-policies.sql
-- Storage bucket creation and access policies.
-- Apply after migrations: psql -f storage-policies.sql
-- Or run via Supabase Studio > Storage.

-- ── Bucket: circuit-artifacts ─────────────────────────────────────────────────
-- Stores compiled Noir ACIR artifacts (age_proof.json, age_proof.vk).
-- Public read so the Next.js build can fetch them; only service_role may write.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'circuit-artifacts',
    'circuit-artifacts',
    true,                          -- public read
    5242880,                       -- 5 MB max per file
    ARRAY['application/json', 'application/octet-stream']
)
ON CONFLICT (id) DO NOTHING;

-- Allow anyone to read circuit artifacts (ACIR JSON is non-secret)
CREATE POLICY "circuit_artifacts_public_read" ON storage.objects
    FOR SELECT
    USING (bucket_id = 'circuit-artifacts');

-- Only service_role may upload/update circuit artifacts (pinned at deploy time)
CREATE POLICY "circuit_artifacts_service_write" ON storage.objects
    FOR INSERT
    WITH CHECK (
        bucket_id = 'circuit-artifacts'
        AND auth.role() = 'service_role'
    );

CREATE POLICY "circuit_artifacts_service_update" ON storage.objects
    FOR UPDATE
    USING (
        bucket_id = 'circuit-artifacts'
        AND auth.role() = 'service_role'
    );

CREATE POLICY "circuit_artifacts_service_delete" ON storage.objects
    FOR DELETE
    USING (
        bucket_id = 'circuit-artifacts'
        AND auth.role() = 'service_role'
    );

-- ── Bucket: study-assets ──────────────────────────────────────────────────────
-- Stores optional study media (images, PDFs).
-- Private; each researcher can only access objects under their own user-id prefix.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'study-assets',
    'study-assets',
    false,                         -- private
    52428800,                      -- 50 MB max per file
    ARRAY[
        'image/jpeg', 'image/png', 'image/webp', 'image/gif',
        'application/pdf',
        'video/mp4', 'video/webm'
    ]
)
ON CONFLICT (id) DO NOTHING;

-- Researchers can read objects under their own prefix: <user_id>/<anything>
CREATE POLICY "study_assets_researcher_read" ON storage.objects
    FOR SELECT
    USING (
        bucket_id = 'study-assets'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

-- Researchers can upload objects under their own prefix
CREATE POLICY "study_assets_researcher_insert" ON storage.objects
    FOR INSERT
    WITH CHECK (
        bucket_id = 'study-assets'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

-- Researchers can update/replace their own objects
CREATE POLICY "study_assets_researcher_update" ON storage.objects
    FOR UPDATE
    USING (
        bucket_id = 'study-assets'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

-- Researchers can delete their own objects
CREATE POLICY "study_assets_researcher_delete" ON storage.objects
    FOR DELETE
    USING (
        bucket_id = 'study-assets'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

-- Service role full access (for backend cleanup jobs)
CREATE POLICY "study_assets_service_role_all" ON storage.objects
    USING (
        bucket_id = 'study-assets'
        AND auth.role() = 'service_role'
    );
