# =============================================================================
# Static site image for Fly.io.  Just nginx serving the repo's HTML / JS / CSV
# from /usr/share/nginx/html.  Fly's load balancer terminates HTTPS so the
# container only needs to listen on plain HTTP on the internal port (8080).
# =============================================================================
FROM nginx:1.27-alpine

# Replace the default nginx site config with one that serves the static
# files, sets a CSV mime type for fetch() requests, and listens on 8080.
COPY nginx.conf /etc/nginx/conf.d/default.conf

WORKDIR /usr/share/nginx/html
RUN rm -rf ./*

# Copy site assets.
COPY index.html historical.html plots.html ./
COPY config.js model.js ./
COPY data ./data

EXPOSE 8080
