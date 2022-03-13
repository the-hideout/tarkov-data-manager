#!/bin/bash

set -e

export DOLLAR='$'

envsubst '$SERVER_NAME $BACKEND_ADDR $BACKEND_PORT $DOLLAR' < /tmp/default.conf > /etc/nginx/conf.d/default.conf
nginx -g 'daemon off;'