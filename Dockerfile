FROM oven/bun

WORKDIR /app

COPY package.json bun.lockb ./
RUN bun install --no-save

COPY . .
RUN bun run build

CMD ["bun", "run", "start"]
