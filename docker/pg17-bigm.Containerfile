# Multica local dev database image.
#
# The official pgvector/pgvector:pg17 image ships pgcrypto, pg_trgm and vector
# but NOT pg_bigm — pg_bigm 1.2 supports only up to PostgreSQL 16. PostgreSQL
# 17 support landed on pg_bigm master after the 1.2 release, so this image
# builds the extension from the upstream master tarball. Once pg_bigm ships a
# release with PG17 support, switch the URL to that release tarball.
#
# Build:  podman build -t multica-postgres:pg17-bigm -f docker/pg17-bigm.Containerfile docker
# Run:    see DEV_PREVIEW.md
FROM pgvector/pgvector:pg17

ARG PG_BIGM_REF=master
ARG PG_BIGM_SHA256=skip

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential ca-certificates curl postgresql-server-dev-17 \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL "https://github.com/pgbigm/pg_bigm/archive/${PG_BIGM_REF}.tar.gz" -o /tmp/pg_bigm.tar.gz \
 && echo "downloaded $(sha256sum /tmp/pg_bigm.tar.gz | cut -d' ' -f1)" \
 && tar -xzf /tmp/pg_bigm.tar.gz -C /tmp \
 && make -C "/tmp/pg_bigm-${PG_BIGM_REF}" USE_PGXS=1 \
 && make -C "/tmp/pg_bigm-${PG_BIGM_REF}" USE_PGXS=1 install \
 && rm -rf /tmp/pg_bigm* \
 && apt-get purge -y build-essential curl postgresql-server-dev-17 \
 && apt-get autoremove -y
