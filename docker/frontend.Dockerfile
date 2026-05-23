FROM oven/bun:1.3.14-alpine AS deps
WORKDIR /app

COPY package.json bun.lock tsconfig.json tsconfig.base.json ./
COPY packages/common/package.json packages/common/package.json
COPY packages/backend/package.json packages/backend/package.json
COPY packages/frontend/package.json packages/frontend/package.json
RUN bun install --frozen-lockfile

FROM deps AS build
ARG FRONT_API_BASE=http://backend:3000
ARG FRONT_FIREBASE_API_KEY=demo-api-key
ARG FRONT_FIREBASE_AUTH_DOMAIN=demo-festival.firebaseapp.com
ARG FRONT_FIREBASE_PROJECT_ID=demo-festival
ARG FRONT_FIREBASE_APP_ID=1:000000000000:web:demo
ARG FRONT_FIREBASE_AUTH_EMULATOR_URL=

ENV FRONT_API_BASE=${FRONT_API_BASE}
ENV FRONT_FIREBASE_API_KEY=${FRONT_FIREBASE_API_KEY}
ENV FRONT_FIREBASE_AUTH_DOMAIN=${FRONT_FIREBASE_AUTH_DOMAIN}
ENV FRONT_FIREBASE_PROJECT_ID=${FRONT_FIREBASE_PROJECT_ID}
ENV FRONT_FIREBASE_APP_ID=${FRONT_FIREBASE_APP_ID}
ENV FRONT_FIREBASE_AUTH_EMULATOR_URL=${FRONT_FIREBASE_AUTH_EMULATOR_URL}

COPY packages/common packages/common
COPY packages/frontend packages/frontend
RUN rm -rf packages/common/dist packages/common/tsconfig.tsbuildinfo \
	&& bun run build:common \
	&& bun run --cwd packages/frontend build

FROM nginx:1.27-alpine AS runtime
WORKDIR /usr/share/nginx/html
COPY docker/nginx.festival.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/packages/frontend/dist ./

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
