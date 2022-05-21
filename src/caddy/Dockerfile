FROM caddy/caddy:2.4.6-alpine

RUN adduser -D nonroot -u 10001

RUN mkdir /app

COPY --chown=nonroot:nonroot start.sh /app/start.sh
COPY --chown=nonroot:nonroot Caddyfile /etc/caddy/Caddyfile
RUN chown -R nonroot:nonroot /app

USER nonroot

CMD ["sh", "/app/start.sh"]
