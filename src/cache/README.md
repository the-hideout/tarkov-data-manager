# cache ♻️

[![deploy](https://github.com/the-hideout/cache/actions/workflows/deploy.yml/badge.svg)](https://github.com/the-hideout/cache/actions/workflows/deploy.yml)
[![config validation](https://github.com/the-hideout/cache/actions/workflows/config-validation.yml/badge.svg)](https://github.com/the-hideout/cache/actions/workflows/config-validation.yml)
[![acceptance](https://github.com/the-hideout/cache/actions/workflows/acceptance.yml/badge.svg)](https://github.com/the-hideout/cache/actions/workflows/acceptance.yml)

A caching service using [Caddy](https://caddyserver.com/) + [Gin](https://github.com/gin-gonic/gin) + [Redis](https://redis.io/) with docker-compose

This service is used to cache all GraphQL responses from the main [Tarkov API](https://github.com/the-hideout/tarkov-api) in order to provide maximum performance ⚡

## About ⭐

This service exists to cache all response from the [Tarkov API](https://github.com/the-hideout/tarkov-api) for performance and to reduce load on our cloudflare workers. It is written in GoLang and is as simple as it needs to be.

This service caches requests only for a short period of time in order to keep data fresh and response times low

### How it Works 📚

This service works by doing the following:

- Recieving requests to save a graphql query in its in-memory cache (redis)
- Serving requests for cached graphql queries from its in-memory cache (redis)
- Expiring cached items at a fixed interval so they can be refreshed

Traffic flow:

1. Request hits the reverse proxy (caddy)
2. The request is routed to the backend caching service (FastAPI)
3. The request can either be a GET (retrieves from the cache) or a POST (saves to the cache)

## Usage 🔨

To use this repo do the following:

1. Clone the repo
2. Run the following command:

    ```bash
    docker-compose up --build
    ```

3. Create a request to the cache endpoint to set an item in the cache:

    ```bash
    curl --location --request POST 'http://localhost/api/cache' \
    --header 'Content-Type: application/json' \
    --data-raw '{
        "key": "mycoolquery",
        "value": "fake response"
    }'
    ```

4. Create a request to retrieve the item you just placed in the cache:

    ```bash
    curl --location --request GET 'http://localhost/api/cache?key=mycoolquery' \
    --header 'Content-Type: application/json' \
    --data-raw '{}'
    ```

5. As an added bonus, inspect your response headers to see how much longer the item will live in the cached before it expires and the request returns a 404 (`X-CACHE-TTL`)

That's it!

## TLS Certificate 🔐

Caddy automatically provisions TLS certificates for you. In order to make use of this awesome feature, do the following:

1. Ensure your server has ports `80` and `443` open
1. Have a DNS record pointed to your server for the domain you wish to obtain a certificate for (e.g. `app.example.org` -> `<IP address>`)
1. Export the env var for the domain you wish to use:

    ```bash
    export DOMAIN=app.example.org
    ```

1. Start the docker-compose stack:

   ```bash
   docker-compose up --build
   ```

1. Navigate to your domain and enjoy your easy TLS setup with Caddy! -> [https://app.example.org](https://app.example.orgg)

## Extra Info 📚

Here is some extra info about the setup!

### Volumes 🛢️

The docker-compose file creates three volumes:

- `./data/caddy_data:/data`
- `./data/caddy_config:/config`
- `./data/redis:/data`

The config volume is used to mount Caddy configuration and Redis data

The data volume is used to store certificate information. This is really important so that you are not re-requesting TLS certs each time you start your container. Doing so can cause you to hit Let's Encrypt rate limits that will prevent you from provisioning certificates

### Environment Variables 📝

If you run the stack without the `DOMAIN` variable set in your environment, the stack will default to using `localhost`. This is ideal for testing out the stack locally.

If you set the `DOMAIN` variable, Caddy will attempt to provision a certificate for that domain. In order to do so, you will need DNS records pointed to that domain and you will need need traffic to access your server via port `80` and `443`
