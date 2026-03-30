# cache

This directory contains the imported cache service from the old standalone `cache` repo.

## Layout

- `src/cache/` contains the service-local scripts and cache-only Docker Compose harness used for unit and acceptance testing.
- `src/cache/src/cache/` contains the Go service, Dockerfile, config, and vendored dependencies.

## Local development

Run the cache-only workflow from this directory:

```bash
cd src/cache
script/bootstrap
script/test
script/acceptance
```

The cache-only compose harness in this directory is for local cache development and CI acceptance coverage.

## Production

Production deployment is owned by the root `tarkov-data-manager` stack. The live OVH deployment runs:

- `cache`
- `redis`
- the shared root Caddy instance that serves `cache.tarkov.dev`

Do not use the old standalone deploy flow from the original cache repo.
