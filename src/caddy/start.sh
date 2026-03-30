#!/bin/bash

set -e

if [ -z "$DOMAIN" ]
then
    export DOMAIN="localhost"
fi

if [ -z "$CACHE_DOMAIN" ]
then
    export CACHE_DOMAIN="cache.localhost"
fi

caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
