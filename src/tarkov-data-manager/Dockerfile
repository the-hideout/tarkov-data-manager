FROM node:20.13.1-slim

WORKDIR /app

RUN chown -R node:node /app

# this line is needed to ensure sharp installs correctly
RUN chown -R node:node /root

# permissions for node-logs volume
RUN mkdir -p /home/node/.npm
RUN chown -R 1000:1000 "/home/node/.npm"

# Update certificate store
RUN apt-get update && apt-get install -y ca-certificates && update-ca-certificates

COPY --chown=node:node . .

RUN npm install

# RUN node script/7z-chmod.mjs

USER node

CMD ./script/wait-for-it.sh database:3306 -- node script/wait-for-db.mjs && npm run start
