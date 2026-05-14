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

# Copy site assets.  controls.{js,css} are shared by the simulator and
# the historical page (added since the original Dockerfile was written —
# must be in this list, or the deployed sliders fall back to unstyled
# defaults and the historical-page sidebar breaks).  historical_legacy.html
# is the pre-redesign snapshot we keep around for reference.
COPY index.html historical.html historical_legacy.html plots.html ./
COPY config.js model.js controls.js ./
COPY controls.css ./
COPY data ./data

EXPOSE 8080
