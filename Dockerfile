FROM node:16
WORKDIR /usr/src/app
COPY * ./
RUN npm ci --ignore-scripts
EXPOSE 5469
COPY .env.example .env
RUN npm run build
CMD [ "npm", "run", "start" ]