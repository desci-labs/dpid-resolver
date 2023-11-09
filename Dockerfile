FROM node:16.17.0
WORKDIR /usr/src/app
COPY . ./
RUN npm install -g npm@9.5.1
RUN npm ci --ignore-scripts
EXPOSE 5460
COPY .env.example .env
RUN npm run build
RUN apt-get install -y bash
CMD [ "npm", "run", "start" ]