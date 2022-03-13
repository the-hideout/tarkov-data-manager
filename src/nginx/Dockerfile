FROM nginx:mainline-alpine

# set workdir
WORKDIR /app

# add certs
COPY --chown=nginx:nginx ssl /data/certs

# Add bash for boot cmd
RUN apk add bash

# Add nginx.conf to container
COPY --chown=nginx:nginx config/nginx.conf /etc/nginx/nginx.conf
# Add the startup file to the container
COPY --chown=nginx:nginx start.sh .

# permissions and nginx user for tightened security
RUN chown -R nginx:nginx /app && chmod -R 755 /app && \
        chown -R nginx:nginx /var/cache/nginx && \
        chown -R nginx:nginx /var/log/nginx && \
        chmod -R 755 /var/log/nginx; \
        chown -R nginx:nginx /etc/nginx/conf.d
RUN touch /var/run/nginx.pid && chown -R nginx:nginx /var/run/nginx.pid

ADD config/default.conf /tmp/default.conf

USER nginx

EXPOSE 80

HEALTHCHECK --start-period=5s --timeout=15s --interval=30s \
        CMD curl --fail http://localhost:80/health-check || exit 1   

CMD ["/app/start.sh"]