CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_skill_version_skill ON skill_version(skill_id, version_number DESC);
