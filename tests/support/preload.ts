// Preloaded by bunfig.toml before any test module (and its env validation)
// loads. Defaults only — an explicitly exported variable always wins.
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:55442/hms_test";
process.env.BETTER_AUTH_SECRET ??= "integration-test-secret-0123456789abcdef";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.CORS_ORIGIN ??= "http://localhost:3001";
process.env.FOUNDING_EMAIL ??= "founder@hms.local";
// Matches packages/db/docker-compose.dev.yaml.
process.env.SEAWEEDFS_ENDPOINT ??= "http://localhost:55451";
process.env.SEAWEEDFS_BUCKET ??= "files";
process.env.SEAWEEDFS_ACCESS_KEY_ID ??= "better-stack";
process.env.SEAWEEDFS_SECRET_ACCESS_KEY ??= "better-stack-secret";
