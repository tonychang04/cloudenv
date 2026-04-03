import type { DetectedStack } from "./detect";

export function generateDockerfile(stack: DetectedStack): string {
  switch (stack.runtime) {
    case "node":
      return nodeDockerfile(stack);
    case "python":
      return pythonDockerfile(stack);
    case "go":
      return goDockerfile(stack);
  }
}

function nodeDockerfile(stack: DetectedStack): string {
  return `FROM node:${stack.version}-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build 2>/dev/null || true

FROM node:${stack.version}-alpine
WORKDIR /app
COPY --from=builder /app .
EXPOSE ${stack.port}
CMD ${JSON.stringify(stack.entrypoint.split(" "))}
`;
}

function pythonDockerfile(stack: DetectedStack): string {
  return `FROM python:${stack.version}-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE ${stack.port}
CMD ${JSON.stringify(stack.entrypoint.split(" "))}
`;
}

function goDockerfile(stack: DetectedStack): string {
  return `FROM golang:${stack.version}-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /app/server .

FROM alpine:3.19
WORKDIR /app
COPY --from=builder /app/server .
EXPOSE ${stack.port}
CMD ["./server"]
`;
}

export function generateDockerignore(): string {
  return `node_modules
.git
dist
__pycache__
.env
.fly
*.log
.DS_Store
`;
}
