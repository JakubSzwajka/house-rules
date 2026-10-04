# The house-rules docs site: built with Node and pnpm, served as static files by Caddy on :80.
# Build from the repo root: docker build -f site/Dockerfile .
FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS build

# The branch, tag or commit that source links point at. The default is main.
ARG SITE_SOURCE_REF=main

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  SITE_SOURCE_REF=$SITE_SOURCE_REF \
  ASTRO_TELEMETRY_DISABLED=1 \
  TURBO_TELEMETRY_DISABLED=1
RUN corepack enable

WORKDIR /repo
COPY . .

# No install scripts run, as in pnpm-workspace.yaml's allowBuilds; the site builds without them.
RUN pnpm install --frozen-lockfile --ignore-scripts --filter "@house-rules/site..." \
  && pnpm --filter @house-rules/site build

FROM caddy:2.11.4-alpine@sha256:6aeddd44c3078b0f9a35206472a11420648a79c184603ef95957d0a20044cb2b

ARG APP_COMMIT=unknown
ENV APP_COMMIT=$APP_COMMIT

COPY site/Caddyfile /etc/caddy/Caddyfile
RUN commit="$(printf '%s' "$APP_COMMIT" | cut -c1-12)" \
  && sed -i "s/__APP_COMMIT__/${commit}/g" /etc/caddy/Caddyfile \
  && caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
COPY --from=build /repo/site/dist/ /srv/

# The caddy binary has cap_net_bind_service, so a non-root user can bind :80.
RUN chown -R 65534:65534 /config /data
USER 65534:65534

EXPOSE 80
