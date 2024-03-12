FROM node:19.3.0-alpine3.16

WORKDIR /app

RUN chown -R node:node /app

# this line is needed to ensure sharp installs correctly
RUN chown -R node:node /root

# permissions for node-logs volume
RUN mkdir -p /home/node/.npm
RUN chown -R 1000:1000 "/home/node/.npm"

COPY --chown=node:node . .

RUN npm install

USER node

CMD ./script/wait-for-it.sh database:3306 -- npm run start
