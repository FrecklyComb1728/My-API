const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const configPath = path.join(__dirname, 'config.json');
const config = require(configPath);

// 创建IP数据缓存
const ipCache = new Map();

// 记录上次使用的API索引，用于轮询策略
let lastUsedApiIndex = -1;

// 存储每个上游API的请求计数和时间窗口
const apiRequestCounters = {};
config.upstream_apis.forEach(api => {
  apiRequestCounters[api.name] = {
    count: 0,
    windowStartTime: Date.now(),
    isAvailable: api.enabled
  };
});

// 重置请求计数器
function resetRequestCounter(apiName) {
  const api = config.upstream_apis.find(a => a.name === apiName);
  if (!api) return;

  apiRequestCounters[apiName] = {
    count: 0,
    windowStartTime: Date.now(),
    isAvailable: api.enabled
  };
}

// 检查API是否可用（未超过频率限制）
function isApiAvailable(apiName) {
  const api = config.upstream_apis.find(a => a.name === apiName);
  if (!api || !api.enabled) return false;

  const counter = apiRequestCounters[apiName];
  const now = Date.now();
  
  // 如果时间窗口已过，重置计数器
  if (now - counter.windowStartTime > api.time_window * 1000) {
    resetRequestCounter(apiName);
    return true;
  }
  
  // 严格检查是否超过请求限制
  return counter.count < api.max_requests;
}

// 获取可用的API列表
function getAvailableApis() {
  return config.upstream_apis.filter(api => isApiAvailable(api.name));
}

// 智能选择下一个API（负载均衡）
function selectNextApi(availableApis) {
  if (!availableApis || availableApis.length === 0) {
    return null;
  }
  
  // 如果只有一个可用API，直接返回
  if (availableApis.length === 1) {
    return availableApis[0];
  }
  
  // 根据配置选择负载均衡策略
  const strategy = config.load_balance_strategy || 'round_robin';
  
  switch (strategy) {
    case 'random':
      // 随机选择一个API
      const randomIndex = Math.floor(Math.random() * availableApis.length);
      return availableApis[randomIndex];
      
    case 'least_used':
      // 选择请求计数最少的API
      return availableApis.reduce((least, current) => {
        const leastCount = apiRequestCounters[least.name].count;
        const currentCount = apiRequestCounters[current.name].count;
        return currentCount < leastCount ? current : least;
      });
      
    case 'round_robin':
    default:
      // 轮询策略
      lastUsedApiIndex = (lastUsedApiIndex + 1) % availableApis.length;
      return availableApis[lastUsedApiIndex];
  }
}

// 更新API请求计数 - 在发送请求前预先增加计数
function incrementApiCounter(apiName) {
  if (!apiRequestCounters[apiName]) return;
  
  apiRequestCounters[apiName].count++;
  console.log(`|- 负载：API ${apiName} 请求计数: ${apiRequestCounters[apiName].count}/${config.upstream_apis.find(a => a.name === apiName).max_requests}`);
}

// 从嵌套对象中获取值，支持多字段拼接
function getNestedValue(obj, path) {
  if (!path) return undefined;
  
  // 如果路径包含逗号，表示需要拼接多个字段
  if (path.includes(',')) {
    const fields = path.split(',');
    return fields.map(field => getNestedValue(obj, field.trim()))
      .filter(v => v) // 过滤掉undefined值
      .join('');
  }
  
  const keys = path.split('.');
  return keys.reduce((o, k) => (o || {})[k], obj);
}

// 映射API返回的数据到标准格式
function mapResponseToStandardFormat(data, fieldMapping) {
  const result = {};
  
  for (const [standardField, apiField] of Object.entries(fieldMapping)) {
    result[standardField] = getNestedValue(data, apiField);
  }
  
  return result;
}

// 检查缓存中是否有有效的IP数据
function getFromCache(ip) {
  if (!ipCache.has(ip)) return null;
  
  const cacheItem = ipCache.get(ip);
  const now = Date.now();
  
  // 检查缓存是否过期
  if (now - cacheItem.timestamp > config.cache_ttl * 1000) {
    // 缓存已过期，删除
    ipCache.delete(ip);
    return null;
  }
  return cacheItem.data;
}

// 将IP数据存入缓存
function saveToCache(ip, data) {
  ipCache.set(ip, {
    data,
    timestamp: Date.now()
  });
}

// 锁定API请求，确保在发送请求前检查并增加计数
async function safeQueryIpInfo(ip, apiConfig) {
  // 再次检查API是否可用（防止并发请求导致计数错误）
  if (!isApiAvailable(apiConfig.name)) {
    throw new Error(`API ${apiConfig.name} 已达到请求限制或不可用`);
  }
  
  // 预先增加计数
  incrementApiCounter(apiConfig.name);
  
  try {
    const url = apiConfig.url.replace('{ip}', ip);
    const response = await axios.get(url, { 
      timeout: config.default_timeout 
    });
    
    const standardData = mapResponseToStandardFormat(
      response.data, 
      apiConfig.field_mapping
    );
    
    // 只保留配置中指定的字段
    const filteredData = {};
    config.response_fields.forEach(field => {
      if (standardData[field] !== undefined) {
        filteredData[field] = standardData[field];
      }
    });
    
    return {
      source: apiConfig.name,
      data: filteredData,
      raw_data: response.data
    };
  } catch (error) {
    console.error(`|- 查询：查询IP(${ip})失败，使用API: ${apiConfig.name}，错误: ${error.message}`);
    const err = new Error(`查询失败: ${error.message}`);
    err.source = apiConfig.name;
    throw err;
  }
}

// 带重试的IP查询
async function queryIpInfoWithRetry(ip) {
  // 先检查缓存
  const cachedData = getFromCache(ip);
  if (cachedData) {
    return cachedData;
  }
  
  // 获取当前可用的API列表
  let availableApis = getAvailableApis();
  
  if (availableApis.length === 0) {
    const err = new Error('所有API都已达到请求限制或不可用');
    err.source = '系统';
    throw err;
  }
  
  // 尝试查询
  let result;
  let lastError;
  let retryCount = 0;
  let triedApis = new Set(); // 记录已尝试过的API
  
  while (retryCount <= config.retry_count) {
    // 每次尝试前重新获取可用API列表
    availableApis = getAvailableApis().filter(api => !triedApis.has(api.name));
    
    // 如果所有API都已尝试过，但还有重试次数，则重置尝试记录
    if (availableApis.length === 0) {
      if (retryCount < config.retry_count) {
        triedApis.clear();
        availableApis = getAvailableApis();
        retryCount++;
        console.log(`|- 查询：所有API尝试失败，开始第${retryCount}次重试`);
        // 短暂延迟后再重试
        await new Promise(resolve => setTimeout(resolve, 100));
      } else {
        break; // 所有重试都失败
      }
    }
    
    // 没有可用API
    if (availableApis.length === 0) {
      break;
    }
    
    // 智能选择下一个API
    const selectedApi = selectNextApi(availableApis);
    if (!selectedApi) {
      break;
    }
    
    try {
      result = await safeQueryIpInfo(ip, selectedApi);
      // 查询成功，保存到缓存
      saveToCache(ip, result);
      return result; // 成功则直接返回
    } catch (error) {
      lastError = error;
      triedApis.add(selectedApi.name); // 记录已尝试过的API
      
      if (retryCount === config.retry_count && triedApis.size === getAvailableApis().length) {
        console.log(`|- 查询：所有可用API都已尝试，查询IP(${ip})失败`);
      }
    }
  }
  
  // 如果所有重试都失败
  if (lastError) {
    throw lastError;
  } else {
    const err = new Error('查询失败，所有API都无法返回结果');
    err.source = '系统';
    throw err;
  }
}

// 获取客户端IP
function getClientIp(req) {
  // 从配置文件读取IP请求头列表
  let ipHeaders = [];
  
  // 检查配置文件中的IP请求头格式
  if (Array.isArray(config.ip_headers)) {
    // 如果是新格式（带优先级的对象数组）
    if (config.ip_headers.length > 0 && typeof config.ip_headers[0] === 'object') {
      // 按优先级排序
      ipHeaders = [...config.ip_headers].sort((a, b) => a.priority - b.priority);
    } else {
      // 如果是旧格式（字符串数组）
      ipHeaders = config.ip_headers.map(header => ({ name: header }));
    }
  } else {
    // 使用默认请求头
    ipHeaders = [
      { name: 'x-forwarded-for', priority: 1 },
      { name: 'x-real-ip', priority: 2 }
    ];
  }
  
  // 按优先级顺序尝试从请求头获取IP
  for (const header of ipHeaders) {
    const headerName = header.name.toLowerCase();
    const headerValue = req.headers[headerName];
    if (headerValue) {
      // 如果是逗号分隔的IP列表，取第一个
      const ips = headerValue.split(',').map(ip => ip.trim()).filter(ip => ip);
      if (ips.length > 0) {
        console.log(`|- IP获取：使用请求头 ${headerName} 获取到IP ${ips[0]}`);
        return ips[0];
      }
    }
  }
  
  // 如果所有请求头都没有找到IP，使用连接的远程地址
  const remoteIp = req.connection.remoteAddress || req.socket.remoteAddress || '';
  console.log(`|- IP获取：使用连接远程地址获取到IP ${remoteIp}`);
  return remoteIp;
}

// 路由处理器

// 查询IP信息的统一处理函数
async function handleIpQuery(ip, res) {
  try {
    const result = await queryIpInfoWithRetry(ip);
    console.log(`|- 查询：IP查询成功，使用源：${result.source}，已缓存`);
    
    // 添加标准日志输出
    const ipInfo = result.data; 
    console.log(`|- IP：${ipInfo.ip}`);
    console.log(`|- 位置：${ipInfo.country || ''}${ipInfo.city || '未知城市'}，ISP：${ipInfo.isp || '未知运营商'}`);
    
    res.json(result);
  } catch (error) {
    console.error(`|- 查询：IP查询失败，错误：${error.message}`);
    
    // 添加失败的标准日志输出
    console.log(`|- 错误：请求失败，${error.message}`);
    console.log(`|- IP：尝试查询下一个上游API`);
    
    res.status(500).json({ error: error.message });
  }
}

// 查看上游API的状态和使用情况
router.get('/list', (req, res) => {
  console.log(`|- 查询：接收到查询API状态列表请求`);
  
  const apiStatus = config.upstream_apis.map(api => {
    const counter = apiRequestCounters[api.name] || { count: 0, windowStartTime: 0, isAvailable: false };
    const now = Date.now();
    const elapsedTime = Math.floor((now - counter.windowStartTime) / 1000);
    const timeLeft = Math.max(0, api.time_window - elapsedTime);
    
    return {
      name: api.name,
      enabled: api.enabled,
      max_requests: api.max_requests,
      time_window: api.time_window,
      current_requests: counter.count,
      time_left: timeLeft,
      available: isApiAvailable(api.name)
    };
  });
  
  // 添加缓存状态信息
  const cacheInfo = {
    enabled: true,
    ttl: config.cache_ttl,
    size: ipCache.size,
    items: Array.from(ipCache.entries()).map(([ip, item]) => ({
      ip,
      source: item.data.source,
      age: Math.floor((Date.now() - item.timestamp) / 1000),
      expires_in: Math.max(0, config.cache_ttl - Math.floor((Date.now() - item.timestamp) / 1000))
    }))
  };
  
  // 添加负载均衡信息
  const loadBalanceInfo = {
    strategy: config.load_balance_strategy || 'round_robin',
    strategies_available: ['round_robin', 'random', 'least_used']
  };
  
  console.log(`|- 缓存：返回API状态列表，共${apiStatus.length}个源，缓存中有${ipCache.size}条记录`);
  
  res.json({
    success: true,
    apis: apiStatus,
    cache: cacheInfo,
    load_balance: loadBalanceInfo,
    config: {
      default_timeout: config.default_timeout,
      retry_count: config.retry_count,
      cache_ttl: config.cache_ttl,
      load_balance_strategy: config.load_balance_strategy || 'round_robin'
    }
  });
});

// 清除缓存的路由
router.get('/clearcache', (req, res) => {
  const size = ipCache.size;
  ipCache.clear();
  console.log(`|- 缓存：已清除所有缓存，共${size}条记录`);
  res.json({
    success: true,
    message: `已清除所有缓存，共${size}条记录`
  });
});

// 查询当前请求的IP信息或指定IP（通过查询参数）
router.get('/', async (req, res) => {
  // 检查是否有ip查询参数
  const queryIp = req.query.ip;
  
  if (queryIp) {
    // 如果有查询参数，使用查询参数中的IP
    return handleIpQuery(queryIp, res);
  } else {
    // 否则查询客户端IP
    const clientIp = getClientIp(req);
    return handleIpQuery(clientIp, res);
  }
});

// 查询指定IP的信息（通过路径参数）
router.get('/:ip', async (req, res) => {
  const ip = req.params.ip;
  return handleIpQuery(ip, res);
});

// 导出路由和IP查询函数，以便在其他模块中使用
module.exports = router;
module.exports.queryIpInfoWithRetry = queryIpInfoWithRetry;
module.exports.getClientIp = getClientIp;