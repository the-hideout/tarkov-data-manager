FROM node:18.4.0-alpine3.15

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

CMD [ "npm", "run", "start" ]
