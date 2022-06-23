# Tarkov Data Manager 🛢️💻

test by grant

[![ci](https://github.com/the-hideout/tarkov-data-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/the-hideout/tarkov-data-manager/actions/workflows/ci.yml) [![Discord](https://img.shields.io/discord/956236955815907388?color=7388DA&label=Discord)](https://discord.gg/XPAsKGHSzH)

The Tarkov Data Manager, which is forked from kokarn's original creation, is a tool to manage the Tarkov item data.

It is a web application that allows you to do the following:

- Start, stop, and interact with scanners
- View the data collected by the scanners
- Make modifications to items or add missing images

## Components 🛠️

This repo contains two main components:

- The **Tarkov Data Manager** - Web application for managing Tarkov game data and scanners
- The **Caddy Reverse Proxy** - Reverse proxy for the Tarkov Data Manager, handles TLS

### Tarkov Data Manager

The Tarkov Data Manager can be run locally without Docker by running the following commands:

> This section is still under construction. We are working on creating a local environment to test the application locally with Docker and a mock instance of the database. Right now, developers connect to a testing branch of the prod database. Developers also need database credentials stored in `src/tarkov-data-manager/creds.env`.
> For active developers with database connections, you can run the following commands:

1. Enter the proper directory:

    ```bash
    cd src/tarkov-data-manager
    ```

1. Install dependencies:

    ```bash
    npm install
    ```

1. Run the application:

    ```bash
    npm run dev
    ```

### Example 📸

![local example](docs/assets/data-manager-example.png)

## Running locally with Docker 🐳

> This is the suggested option for local development

First, edit the `src/tarkov-data-manager/creds.env` file to include your proper credentials.

> An example of this file can be found at [`src/tarkov-data-manager/creds.env.example`](src/tarkov-data-manager/creds.env.example).

You now have two options to start the docker-compose stack (both do the exact same thing):

- `make run`
- `docker-compose up --build`

Browse to your web app when it starts up [localhost](https://localhost).

### creds.env variables

The following variables should be configured in your creds.env file for the data manager to function properly:

- `AWS_SECRET_ACCESS_KEY`/`AWS_ACCESS_KEY_ID`: For interacting with the AWS bucket where images are stored.
- `AUTH_PASSWORD`: The password to log into the web interface.
- `AUTH_SECRET`: Used for secure cookies.
- `CLOUDFLARE_TOKEN`: Used for putting data in cloudflare for the API.
- `PSCALE_USER`/`PSCALE_PASS`: Username and password for the database.
- `TC_USERNAME`/`TC_PASSWORD`/`TC_URL`: Connect to tarkov-changes to get latest item information.
- `TB_KEY`/`TB_URL`: Connect to tarkov-bot to get latest translation information.
- `WS_PASSWORD`: Used to authenticate commands sent to price scanners.
- `WEBHOOK_URL`: The Discord webhook url for alerts.
- `WEBHOOK_USER`: The optional user name that should be used for any sent Discord webhook alerts.
