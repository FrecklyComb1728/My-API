# API中转服务

这是一个API中转服务，可以管理多个相互独立的API模块。每个API作为独立的"插件"运行，互不影响。

## 功能特点

- 模块化API设计，支持多个独立API
- 统一的API路由和配置管理
- 自动加载和注册API模块
- 跨域支持

## 已实现的API
 <details>
<summary><a href="./ip.md">IP地址查询服务</a> - 查询IP地址的地理位置、ISP等信息</summary> 

  - 支持多个上游API轮询
  - 自动限制每个上游API的请求频率
  - 自动重试机制
  - 状态监控接口
  - 统一不同上游API的返回格式
  - 支持多字段拼接返回值
 </details>
 
## 安装和运行

```bash
# 安装依赖
npm install

# 开发模式运行
npm run dev

# 生产模式运行
npm start
```

## API端点

- `GET /` - 返回所有可用API的列表
- `GET /api/ipinfo` - IP查询API
  - `GET /api/ipinfo/list` - 查看上游API的状态和使用情况
  - `GET /api/ipinfo` - 查询当前请求的IP信息（根据配置的请求头获取IP）
    - `GET /api/ipinfo/{ip}` - 查询指定IP的信息
    - `GET /api/ipinfo/?ip={ip}`
    - `GET /api/ipinfo?ip={ip}`


## 配置文件

### 主配置文件 (index-config.json)

```json
{
  "server": {
    "port": 3000
  },
  "apis": {
    "ip": {
      "path": "api/ip",
      "enabled": true,
      "description": "IP地址查询API"
    }
  }
}
```

### IP API配置文件 (api/ip/config.json)

```json
{
  "upstream_apis": [
    {
      "name": "API名称",
      "url": "API URL，使用{ip}作为IP占位符",
      "max_requests": 每个时间窗口内的最大请求数,
      "time_window": 时间窗口（秒）,
      "enabled": true/false,
      "field_mapping": {
        "ip": "上游API中对应的IP字段",
        "city": "上游API中对应的城市字段",
        "country": "上游API中对应的国家字段",
        "isp": "上游API中对应的ISP字段"
      }
    }
  ],
  "default_timeout": 请求超时时间（毫秒）,
  "retry_count": 重试次数,
  "response_fields": [
    "ip",
    "city",
    "country",
    "isp"
  ]
}
```

## 添加新API

要添加新的API，请按照以下步骤操作：

1. 在 `api` 目录下创建新的文件夹，例如 `api/newapi`
2. 创建入口文件 `api/newapi/index.js`，实现API的路由处理
3. 在主配置文件 `index-config.json` 中添加新API的配置：

```json
{
  "proxies": [
    {
      "prefix": "/ipinfo",
      "index": "api/ip/index.js",
      "description": "IP地址查询服务"
    },
    {
      "prefix": "/newapi",
      "index": "api/newapi/index.js",
      "description": "新API服务"
    }
  ]
}
```

## 许可证
Unlicense license
