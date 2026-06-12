FROM node:22
LABEL maintainer="RCaldas <docker@rcaldas.com>"

RUN npm install -g npm@latest

WORKDIR /app
COPY package*.json ./
RUN npm install

COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]