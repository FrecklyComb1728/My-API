# Mifeng API

这是一个兼容Node.js和Deno的简单API项目。

## 安装

```bash
npm install

pnpm install
```

## 在Node.js中运行

```bash
npm run start

pnpm start
```

## 在Deno中运行

```bash
npm run deno

pnpm deno
```

## API端点

- GET `/` - 返回欢迎消息

## 可用的API服务

- [IP地址查询服务](./docs/ip.md) - 查询IP地址的地理位置、ISP等信息

## 添加新API

在 `./api` 文件夹下创建新的文件夹，每个文件夹代表一个独立的API模块。每个模块应包含一个 `index.js` 文件，定义该API的路由。API的路径匹配通过 `api-config.json` 配置文件进行管理。

例如：

```
api/
  weather/
    index.js
    config.json
  ip/
    index.js
    config.json
```

在 `api-config.json` 中配置API路径：

```json
{
  "proxies": [
    {
      "prefix": "/weather",
      "index": "weather/index.js",
      "description": "天气API服务"
    },
    {
      "prefix": "/ip",
      "index": "ip/index.js",
      "description": "IP地址查询服务"
    }
  ]
}
```

## 文档

所有API的详细文档位于 [docs](./docs) 目录。 