# IP API 服务

这是一个IP地址查询服务，可以查询IP地址的地理位置和ISP信息。服务支持多个上游API源，自动负载均衡，缓存机制和失败重试。

## 功能特点

- 支持多个上游API源，自动负载均衡
- 多种负载均衡策略（轮询、随机、最少使用）
- 自动限制每个上游API的请求频率
- 自动重试机制，提高查询成功率
- 数据缓存机制，减少重复查询
- 支持IPv4和IPv6地址查询
- 统一不同上游API的返回格式
- 支持多字段拼接返回值
- 详细的日志记录

## API端点

### 基础查询
- `GET /api/ipinfo` - 查询当前请求的IP信息
- `GET /api/ipinfo/{ip}` - 查询指定IP的信息（路径参数）
- `GET /api/ipinfo?ip={ip}` - 查询指定IP的信息（查询参数）

### 管理接口
- `GET /api/ipinfo/list` - 查看上游API的状态、缓存和使用情况
- `GET /api/ipinfo/clearcache` - 清除所有IP数据缓存
- `GET /api/ipinfo/setbalance/{strategy}` - 设置负载均衡策略

## 配置说明

### 主配置文件

IP API服务需要在主配置文件 `index-config.json` 中启用：

```json
{
  "server": {
    "port": 3000
  },
  "proxies": [
    {
      "prefix": "/ipinfo",
      "index": "api/ip/index.js",
      "description": "IP地址查询API"
    }
  ]
} 
```

### API配置文件

API配置文件位于 `api/ip/config.json`，包含以下主要配置项：

```json
{
  "upstream_apis": [
    {
      "name": "api名称",
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
  "cache_ttl": 缓存有效时间（秒）,
  "load_balance_strategy": "负载均衡策略",
  "ip_headers": [
    {"name": "x-forwarded-for", "priority": 1},
    {"name": "x-real-ip", "priority": 2},
    {"name": "x-client-ip", "priority": 3}
  ],
  "response_fields": [
    "ip",
    "city",
    "country",
    "isp"
  ]
}
```

#### 配置项详解

##### 上游API配置

每个上游API需要配置以下参数：

| 参数 | 类型 | 说明 |
|------|------|------|
| name | 字符串 | API源的唯一标识名称 |
| url | 字符串 | API的URL，使用{ip}作为IP地址的占位符 |
| max_requests | 整数 | 在time_window时间内允许的最大请求数，设为0表示不限制 |
| time_window | 整数 | 请求限制的时间窗口，单位为秒 |
| enabled | 布尔值 | 是否启用该API源 |
| field_mapping | 对象 | 字段映射配置，用于将上游API的字段映射到标准字段 |

##### IP请求头配置

`ip_headers` 配置项用于指定获取客户端IP地址时使用的HTTP请求头及其优先级。系统会按照优先级顺序尝试从这些请求头中获取IP地址。

每个IP请求头配置包含以下参数：

| 参数 | 类型 | 说明 |
|------|------|------|
| name | 字符串 | HTTP请求头名称，不区分大小写 |
| priority | 整数 | 优先级，数字越小优先级越高 |

系统会按照优先级从低到高（数字从小到大）的顺序尝试从请求头中获取IP地址。如果在某个请求头中找到有效的IP地址，将立即返回，不再检查后续的请求头。

如果所有配置的请求头都没有找到有效的IP地址，系统会尝试使用 `req.connection.remoteAddress` 或 `req.socket.remoteAddress` 作为客户端IP地址。

**支持的常用IP请求头**：

- `x-forwarded-for` - 最常用的代理IP请求头，通常包含客户端原始IP
- `x-real-ip` - 常见于Nginx等反向代理
- `x-client-ip` - 某些CDN和代理服务使用
- `cf-connecting-ip` - Cloudflare特有的请求头
- `x-forwarded` - 通用转发请求头
- `forwarded-for` - 转发请求头变体
- `forwarded` - 标准HTTP转发请求头

##### 字段映射

字段映射用于统一不同上游API的返回格式。每个上游API都有自己的字段映射配置，指定如何将上游API的字段映射到标准字段。

支持的标准字段包括：
- `ip` - IP地址
- `city` - 城市
- `country` - 国家/地区名称
- `isp` - 互联网服务提供商

**多字段拼接功能**：可以指定多个字段用逗号分隔，系统会按顺序获取这些字段的值并拼接。例如：

```json
"field_mapping": {
  "city": "province,city,district"
}
```

如果上游API返回的数据为：`{"province": "广东省", "city": "深圳市", "district": "南山区"}`，则最终返回的`city`字段值将为`"广东省深圳市南山区"`。

##### 全局配置

| 参数 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| default_timeout | 整数 | 请求超时时间，单位为毫秒 | 5000 |
| retry_count | 整数 | 查询失败时的重试次数 | 3 |
| cache_ttl | 整数 | 缓存的有效时间，单位为秒 | 3600 |
| load_balance_strategy | 字符串 | 负载均衡策略 | "round_robin" |
| ip_headers | 数组 | 获取客户端IP的HTTP请求头及其优先级配置 | 见IP请求头配置部分 |
| response_fields | 数组 | 响应中包含的字段 | ["ip", "city", "country", "isp"] |

##### 负载均衡策略

系统支持三种负载均衡策略，通过`load_balance_strategy`配置：

1. **round_robin**（轮询）：按顺序循环使用每个可用的API，确保请求均匀分布
2. **random**（随机）：随机选择一个可用的API，适合负载分布较为均衡的场景
3. **least_used**（最少使用）：选择请求计数最少的API，优先使用负载较轻的API

选择建议：
- 如果所有API的性能和限制相似，推荐使用`round_robin`
- 如果API的性能和可靠性有差异，可以使用`least_used`
- 如果希望请求分布更加随机化，可以使用`random`

## 缓存机制

缓存机制可以减少对上游API的重复请求，提高响应速度并避免超出API请求限制。

- `cache_ttl`: 缓存的有效时间，单位为秒。默认为3600秒（1小时）。

例如，设置为86400表示缓存24小时，设置为300表示缓存5分钟。

缓存使用内存存储，服务重启后缓存会被清空。可以通过`/api/ipinfo/clearcache`接口手动清除缓存。

## 日志格式

系统使用标准化的日志格式，方便监控和排查问题。

### 成功请求日志示例

```
[请求] ========================
[调度] 收到请求 /api/ipinfo?ip=59.110.31.45，移交 ip/index.js
|- IP获取：使用请求头 x-forwarded-for 获取到IP 59.110.31.45
|- 上游：ip9
|- IP：59.110.31.45，ISP：阿里云
|- 国家：中国，地区：北京北京
```

### 失败请求日志示例

```
[请求] ========================
[调度] 收到请求 /api/ipinfo?ip=59.110.31.45，移交 ip/index.js
|- IP获取：使用请求头 x-real-ip 获取到IP 59.110.31.45
|- 上游：ip9
|- 错误：请求失败，timeout of 5000ms exceeded
|- IP：尝试查询下一个上游API
```

### IP获取日志示例

```
|- IP获取：使用请求头 x-forwarded-for 获取到IP 8.8.8.8
|- IP获取：使用请求头 x-real-ip 获取到IP 1.1.1.1
|- IP获取：使用请求头 x-client-ip 获取到IP 9.9.9.9
|- IP获取：使用连接远程地址获取到IP ::1
```

## 响应格式

### 成功响应

```json
{
  "source": "使用的上游API名称",
  "data": {
    "ip": "IP地址",
    "city": "城市",
    "country": "国家/地区",
    "isp": "互联网服务提供商"
  },
  "raw_data": {
    // 上游API返回的原始数据
  }
}
```

### 失败响应

```json
{
  "error": "错误信息"
}
```

## 管理接口使用

### 查看API状态和缓存

`GET /api/ipinfo/list`

返回示例：
```json
{
  "success": true,
  "apis": [
    {
      "name": "ip9",
      "enabled": true,
      "max_requests": 40,
      "time_window": 60,
      "current_requests": 5,
      "time_left": 30,
      "available": true
    }
  ],
  "cache": {
    "enabled": true,
    "ttl": 3600,
    "size": 25,
    "items": [
      {
        "ip": "1.1.1.1",
        "source": "ip9",
        "age": 120,
        "expires_in": 3480
      }
    ]
  },
  "load_balance": {
    "strategy": "round_robin",
    "strategies_available": ["round_robin", "random", "least_used"]
  },
  "config": {
    "default_timeout": 5000,
    "retry_count": 3,
    "cache_ttl": 3600,
    "load_balance_strategy": "round_robin"
  }
}
```

### 清除缓存

`GET /api/ipinfo/clearcache`

返回示例：
```json
{
  "success": true,
  "message": "已清除所有缓存，共25条记录"
}
```

### 设置负载均衡策略

`GET /api/ipinfo/setbalance/{strategy}`

可用的策略：`round_robin`, `random`, `least_used`

返回示例：
```json
{
  "success": true,
  "message": "已更新负载均衡策略为: round_robin",
  "load_balance": {
    "strategy": "round_robin",
    "strategies_available": ["round_robin", "random", "least_used"]
  }
}
```

## 配置示例

### 完整配置示例

```json
{
  "upstream_apis": [
    {
      "name": "ip9",
      "url": "https://ip9.com.cn/get?ip={ip}",
      "max_requests": 40,
      "time_window": 60,
      "enabled": true,
      "field_mapping": {
        "ip": "data.ip",
        "city": "data.prov,data.city,data.area",
        "country": "data.country",
        "isp": "data.isp"
      }
    },
    {
      "name": "vvhan",
      "url": "https://api.vvhan.com/api/ipInfo?ip={ip}",
      "max_requests": 120,
      "time_window": 60,
      "enabled": true,
      "field_mapping": {
        "ip": "ip",
        "city": "info.prov,info.city",
        "country": "info.country",
        "isp": "info.isp"
      }
    },
    {
      "name": "netart",
      "url": "https://ipvx.netart.cn/?ip={ip}",
      "max_requests": 120,
      "time_window": 60,
      "enabled": true,
      "field_mapping": {
        "ip": "ip",
        "city": "regions_short",
        "country": "country.name",
        "isp": "as.info"
      }
    }
  ],
  "default_timeout": 5000,
  "retry_count": 3,
  "cache_ttl": 3600,
  "load_balance_strategy": "round_robin",
  "response_fields": [
    "ip",
    "city",
    "country",
    "isp"
  ]
}
```

### 禁用某个API源

如果某个API源不稳定或不可用，可以将其`enabled`设置为`false`：

```json
{
  "name": "unstable_api",
  "url": "https://unstable-api.example.com/ip?q={ip}",
  "max_requests": 60,
  "time_window": 60,
  "enabled": false,
  "field_mapping": {
    "ip": "ip",
    "city": "location.city",
    "country": "location.country",
    "isp": "network.isp"
  }
}
```

### 设置无限制的API源

如果某个API源没有请求限制，可以将`max_requests`和`time_window`设置为0：

```json
{
  "name": "unlimited_api",
  "url": "https://unlimited-api.example.com/ip/{ip}",
  "max_requests": 0,
  "time_window": 0,
  "enabled": true,
  "field_mapping": {
    "ip": "ip",
    "city": "city",
    "country": "country",
    "isp": "isp"
  }
}
```

## 故障排除

### 常见问题

1. **所有API都达到请求限制**
   - 增加`max_requests`或减少`time_window`
   - 添加更多API源
   - 增加缓存时间`cache_ttl`减少请求频率

2. **查询超时**
   - 检查网络连接
   - 增加`default_timeout`值
   - 检查上游API是否可用

3. **字段映射错误**
   - 检查上游API的响应格式是否变化
   - 更新`field_mapping`配置

4. **内存占用过高**
   - 减少`cache_ttl`或定期调用`/api/ipinfo/clearcache`清除缓存