-- Enable PostGIS for geo queries
CREATE EXTENSION IF NOT EXISTS postgis;

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enable pg_trgm for fuzzy text search on listings
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Enable unaccent for search normalisation
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Temporal needs its own schema (auto-setup handles this, but just in case)
-- CREATE SCHEMA IF NOT EXISTS temporal;

\echo 'Owmee DB extensions installed.'
