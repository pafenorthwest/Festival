FROM node:22-alpine
WORKDIR /workspace

RUN npm install -g firebase-tools@13.35.1
COPY docker/firebase.json ./firebase.json

EXPOSE 9099 4000
CMD ["firebase", "emulators:start", "--project", "demo-festival", "--config", "./firebase.json", "--only", "auth"]
