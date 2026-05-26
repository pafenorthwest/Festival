FROM oven/bun:1.3.14-alpine AS deps
WORKDIR /app

COPY package.json bun.lock tsconfig.json tsconfig.base.json ./
COPY packages/common/package.json packages/common/package.json
COPY packages/backend/package.json packages/backend/package.json
COPY packages/frontend/package.json packages/frontend/package.json
RUN bun install --frozen-lockfile

FROM deps AS build
COPY packages/common packages/common
COPY packages/backend packages/backend
RUN rm -rf packages/common/dist packages/common/tsconfig.tsbuildinfo \
	packages/backend/dist packages/backend/tsconfig.tsbuildinfo \
	&& bun run build:common \
	&& bun run build:backend

FROM oven/bun:1.3.14-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/packages/common/dist packages/common/dist
COPY --from=build /app/packages/backend/dist packages/backend/dist
COPY package.json bun.lock ./
COPY packages/common/package.json packages/common/package.json
COPY packages/backend/package.json packages/backend/package.json
COPY packages/frontend/package.json packages/frontend/package.json
RUN bun install --frozen-lockfile --production

EXPOSE 3000
CMD ["bun", "./packages/backend/dist/index.js"]
