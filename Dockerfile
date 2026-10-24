# WEN MC Launcher - Sealos 部署镜像
FROM node:20-alpine

WORKDIR /app

# 依赖安装（国内镜像加速）
COPY package.json ./
RUN npm install --registry=https://registry.npmmirror.com --no-audit --no-fund

# 拷贝源码
COPY server.js ./
COPY config.json ./
COPY lib ./lib
COPY public ./public

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server.js"]
