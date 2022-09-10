FROM node:18.4.0-alpine3.15

WORKDIR /app

RUN chown -R node:node /app

RUN chown -R node:node /root

COPY --chown=node:node . .

RUN npm install

USER node

CMD [ "npm", "run", "start" ]
