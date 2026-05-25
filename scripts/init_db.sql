-- Create an isolated local test database for backend E2E tests. The app uses
-- the owmee database; pytest defaults to owmee_test so test writes never touch
-- the shared dev database.
SELECT 'CREATE DATABASE owmee_test OWNER owmee'
WHERE NOT EXISTS (
    SELECT FROM pg_database WHERE datname = 'owmee_test'
)\gexec

-- Enable extensions on the app database.
CREATE EXTENSION IF NOT EXISTS postgis;

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enable pg_trgm for fuzzy text search on listings
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Enable unaccent for search normalisation
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Temporal needs its own schema (auto-setup handles this, but just in case)
-- CREATE SCHEMA IF NOT EXISTS temporal;

\connect owmee_test

-- Enable the same extensions on the local E2E test database.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

\connect owmee

\echo 'Owmee DB extensions installed.'
