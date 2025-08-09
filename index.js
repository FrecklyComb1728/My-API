const express = require('express');
const fs = require('fs');
const path = require('path');

// ==================== 全局配置和常量 ====================
const config = require('./index-config.json');
const app = express();
const publicPath = path.join(__dirname, 'public');
const errorTemplatePath = path.join(publicPath, 'html/error.html');

// 错误信息映射
const errorMessages = {
  400: { message: '请求格式错误', description: '服务器无法理解您的请求，请检查请求格式是否正确。' },
  401: { message: '未授权访问', description: '您没有权限访问此内容，请先进行身份验证。' },
  403: { message: '禁止访问', description: '服务器拒绝了您的请求，您没有访问此内容的权限。' },
  404: { message: '资源不存在', description: '您访问的页面不存在或已被移除。' },
  409: { message: '资源冲突', description: '请求与服务器当前状态发生冲突，无法完成操作。' },
  500: { message: '服务器内部错误', description: '服务器遇到了意外情况，无法完成请求。' },
  501: { message: '功能未实现', description: '服务器不支持完成请求所需的功能。' },
  502: { message: '网关错误', description: '服务器作为网关或代理，从上游服务器收到无效响应。' },
  503: { message: '服务暂不可用', description: '服务器暂时不可用，请稍后重试。' }
};

// MIME类型映射
const mimeTypes = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.txt': 'text/plain', '.xml': 'application/xml',
  '.md': 'text/markdown', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.wav': 'audio/wav', '.mp4': 'video/mp4', '.woff': 'application/font-woff',
  '.woff2': 'application/font-woff2', '.ttf': 'application/font-sfnt',
  '.otf': 'application/font-sfnt', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.avif': 'image/avif', '.pdf': 'application/pdf', '.mp3': 'audio/mpeg',
  '.aac': 'audio/aac', '.flac': 'audio/flac', '.ogg': 'audio/ogg',
  '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.ts': 'video/mp2t',
  '.mov': 'video/quicktime', '.avi': 'video/x-msvideo'
};

// 主页文件路径
const indexPath = path.resolve(publicPath, 'html/index.html');

// ==================== 工具函数 ====================
// 获取客户端IP地址
function getClientIp(req) {
  try {
    const ipConfig = require('./api/ip/config.json');
    let ipHeaders = [];
    
    if (Array.isArray(ipConfig.ip_headers)) {
      if (ipConfig.ip_headers.length > 0 && typeof ipConfig.ip_headers[0] === 'object') {
        ipHeaders = [...ipConfig.ip_headers].sort((a, b) => a.priority - b.priority);
      } else {
        ipHeaders = ipConfig.ip_headers.map(header => ({ name: header }));
      }
      
      for (const header of ipHeaders) {
        const headerName = header.name.toLowerCase();
        const headerValue = req.headers[headerName];
        if (headerValue) {
          const ips = headerValue.split(',').map(ip => ip.trim()).filter(ip => ip);
          if (ips.length > 0) return ips[0];
        }
      }
    }
  } catch (error) {
    console.error('[IP获取] 读取配置文件失败，使用默认配置:', error.message);
  }
  
  const forwardedIpsStr = req.headers['x-forwarded-for'] || '';
  const forwardedIps = forwardedIpsStr.split(',').map(ip => ip.trim());
  return forwardedIps[0] || req.headers['x-real-ip'] || req.connection.remoteAddress || req.socket.remoteAddress || '';
}

// 获取IP位置信息
async function getIpLocation(ip) {
  try {
    const ipModule = require('./api/ip/index');
    const ipInfo = await ipModule.queryIpInfoWithRetry(ip);
    return {
      location: ipInfo.data.country ? `${ipInfo.data.country}${ipInfo.data.city || ''}` : (ipInfo.data.city || '未知'),
      isp: ipInfo.data.isp || '未知'
    };
  } catch (error) {
    console.error(`[IP查询] 获取IP位置信息失败: ${error.message}`);
    return { location: '未知', isp: '未知' };
  }
}

// 记录请求日志
async function logRequest(urlPath, clientIp, statusCode = 200) {
  console.log(`|- 文件：收到请求路径 ${urlPath}，返回${statusCode >= 400 ? '失败' : '成功'} ${statusCode}`);
  console.log(`|- IP：${clientIp}`);
  
  try {
    const ipInfo = await getIpLocation(clientIp);
    console.log(`|- 位置：${ipInfo.location}，ISP：${ipInfo.isp}`);
  } catch (error) {
    console.log(`|- 位置：未知，ISP：未知`);
  }
}

// 计算运行时间
function getRunningTime() {
  const startDateStr = config.service?.start_date || '2025/01/01';
  const startDate = new Date(startDateStr);
  const now = new Date();
  const diffTime = Math.abs(now - startDate);
  const days = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diffTime % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diffTime % (1000 * 60 * 60)) / (1000 * 60));
  return `${days}天${hours}小时${minutes}分钟`;
}

// 查找文件（支持不带扩展名）
function findFile(filePath, callback) {
  filePath = decodeURIComponent(filePath);
  
  // 检查文件是否直接存在
  if (fs.existsSync(filePath)) {
    // 如果是.md.txt文件，直接返回，不做转换
    if (filePath.toLowerCase().endsWith('.md.txt')) {
      return callback(null, filePath);
    }
    return callback(null, filePath);
  }
  
  const ext = path.extname(filePath);
  const dir = path.dirname(filePath);
  const basename = path.basename(filePath, ext); // 不带扩展名的文件名
  
  // 尝试不同的文件扩展名组合
  const possiblePaths = [];
  
  // 如果请求的是.md文件但不存在，尝试不带扩展名的文件
  if (ext.toLowerCase() === '.md') {
    possiblePaths.push(path.join(dir, basename));
  }
  
  // 如果请求没有扩展名，尝试添加.md扩展名
  if (!ext) {
    possiblePaths.push(path.join(dir, `${basename}.md`));
  }
  
  // 检查可能的路径
  for (const possiblePath of possiblePaths) {
    if (fs.existsSync(possiblePath)) {
      return callback(null, possiblePath);
    }
  }
  
  // 如果没有扩展名，查找目录中所有匹配的文件
  if (!ext) {
    try {
      const files = fs.readdirSync(dir);
      const matchingFiles = files.filter(file => {
        const fileBasename = path.basename(file, path.extname(file));
        return fileBasename === basename;
      });
      
      if (matchingFiles.length === 0) {
        return callback(null, null, 404);
      } else if (matchingFiles.length === 1) {
        return callback(null, path.join(dir, matchingFiles[0]));
      } else {
        // 优先选择.md文件，除非是.md.txt文件
        const mdFile = matchingFiles.find(file => {
          const lowerFile = file.toLowerCase();
          return path.extname(lowerFile) === '.md' && !lowerFile.endsWith('.md.txt');
        });
        
        if (mdFile) {
          console.log(`[调度] 文件"${basename}"有多个版本，优先选择Markdown文件: ${mdFile}`);
          return callback(null, path.join(dir, mdFile));
        }
        
        console.log(`[调度] 文件"${basename}"有多个版本: ${matchingFiles.join(', ')}`);
        return callback(null, null, 409);
      }
    } catch (err) {
      console.error(`[调度] 读取目录失败: ${err.message}`);
      return callback(null, null, 404);
    }
  }
  
  // 如果所有尝试都失败，返回404
  return callback(null, null, 404);
}

// 处理Markdown文件转换
function handleMarkdownFile(filePath, res) {
  try {
    const marked = require('marked');
    const markdownContent = fs.readFileSync(filePath, 'utf8');
    const htmlContent = marked.parse(markdownContent);
    
    // 使用markdown.html模板
    let templatePath = path.join(publicPath, 'html/markdown.html');
    if (fs.existsSync(templatePath)) {
      let template = fs.readFileSync(templatePath, 'utf8');
      // 替换模板中的变量
      const fileName = path.basename(filePath, '.md');
      const renderedHtml = template
        .replace(/\$\{path\.basename\(filePath, '\.md'\)\}/g, fileName)
        .replace(/\$\{htmlContent\}/g, htmlContent);
      
      res.setHeader('Content-Type', 'text/html');
      res.send(renderedHtml);
    }
    
    console.log(`|- 转换：Markdown文件已转换为HTML输出`);
    return true;
  } catch (error) {
    console.error(`[调度] Markdown转换失败: ${error.message}`);
    return false;
  }
}

// ==================== 中间件配置 ====================
// 基本中间件
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('json spaces', 2);

// 跨域设置
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH');
    return res.status(200).json({});
  }
  next();
});

// 自定义状态码响应中间件
app.use((req, res, next) => {
  const originalStatus = res.status;
  
  res.status = function(statusCode) {
    originalStatus.call(this, statusCode);
    
    if (errorMessages[statusCode]) {
      console.log(`[调度] 返回状态码: ${statusCode}，错误信息: ${errorMessages[statusCode].message}`);
      
      try {
        if (fs.existsSync(errorTemplatePath)) {
          let errorTemplate = fs.readFileSync(errorTemplatePath, 'utf8');
          const { message, description } = errorMessages[statusCode] || 
                { message: `错误 ${statusCode}`, description: '发生未知错误' };
          
          errorTemplate = errorTemplate
            .replace(/{{code}}/g, statusCode)
            .replace(/{{message}}/g, message)
            .replace(/{{description}}/g, description);
          
          this.type('html');
          this.send(errorTemplate);
          return this;
        }
      } catch (err) {
        console.error(`[调度] 错误: ${errorTemplatePath}`, err);
      }
      
      this.type('text');
      this.send(`错误 ${statusCode}: ${errorMessages[statusCode].message}`);
      return this;
    }
    
    return this;
  };
  
  next();
});

// ==================== 路由配置 ====================
// 注册API路由
config.proxies.forEach(proxy => {
  try {
    const apiPath = path.resolve(__dirname, proxy.index);
    
    if (!fs.existsSync(apiPath)) {
      console.error(`[调度] API路径不存在: ${apiPath}`);
      return;
    }
    
    const apiRouter = require(apiPath);
    const routePath = `/api${proxy.prefix}`;
    
    app.use(routePath, (req, res, next) => {
      console.log(`[请求] ===============================================`);
      console.log(`[调度] 收到请求 ${req.originalUrl}，移交 ${proxy.index}`);
      
      const originalJson = res.json;
      res.json = function(data) {
        originalJson.call(this, data);
      };
      
      next();
    });
    
    app.use(routePath, apiRouter);
  } catch (error) {
    console.error(`[调度] API路由加载失败: ${error.message}`);
  }
});

// 主页路由
app.get('/', (req, res) => {
  const accept = req.headers.accept || '';
  if (accept.includes('application/json')) {
    const apiInfo = config.proxies.map(proxy => ({
      path: `/api${proxy.prefix}`,
      description: proxy.description
    }));
    
    return res.json({
      name: "API中转服务",
      version: "1.0.0",
      apis: apiInfo
    });
  }
  
  res.sendFile(indexPath);
});

// 处理 favicon.ico 请求
app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(publicPath, 'image/favicon.ico'));
});

// 静态文件处理路由
app.get('/*', async (req, res) => {
  const urlPath = req.path;
  console.log(`[请求] ===========================================`);
  console.log(`[调度] 收到请求 ${urlPath}，使用文件模块处理`);
  
  const clientIp = getClientIp(req);
  let requestPath = urlPath.startsWith('/') ? urlPath.slice(1) : urlPath;
  
  // URL解码
  try {
    const decodedPath = decodeURIComponent(requestPath);
    if (decodedPath !== requestPath) {
      console.log(`[调度] URL解码: ${requestPath} -> ${decodedPath}`);
      requestPath = decodedPath;
    }
  } catch (e) {
    console.error(`[调度] URL解码失败: ${e.message}`);
  }
  
  const filePath = path.join(publicPath, requestPath);
  
  // 处理favicon.ico请求
  if (requestPath === 'favicon.ico') {
    return handleFaviconRequest(filePath, res);
  }
  
  // 处理目录请求
if (requestPath.endsWith('/') || requestPath === '') {
  console.log(`[调度] 检测到目录请求: ${requestPath}`);
  return await handleDirectoryRequest(urlPath, clientIp, res);
}
  
  // 处理文件请求
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return await handleFileRequest(filePath, urlPath, clientIp, res);
  }
  
  // 查找文件（支持不带扩展名）
  findFile(filePath, async (err, foundPath, statusCode) => {
    if (statusCode && !foundPath) {
      return await logAndRespond(urlPath, clientIp, statusCode, res);
    }
    
    if (foundPath) {
      return await handleFileRequest(foundPath, urlPath, clientIp, res);
    } else {
      return await logAndRespond(urlPath, clientIp, 404, res);
    }
  });
});

// 处理favicon请求
function handleFaviconRequest(filePath, res) {
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return res.sendFile(filePath);
  }
  return res.status(404).end();
}

// 处理目录请求
async function handleDirectoryRequest(urlPath, clientIp, res) {
  console.log(`[调度] 处理目录请求: ${urlPath}`);
  
  // 检查是否存在index.html或index.md
  const htmlIndex = path.join(publicPath, 'html/index.html');
  const mdIndex = path.join(publicPath, 'html/index.md');
  const readmeIndex = path.join(publicPath, 'docs/README.md');
  
  // 记录检查的文件路径
  console.log(`[调度] 检查索引文件: ${htmlIndex}`);
  console.log(`[调度] 检查索引文件: ${mdIndex}`);
  console.log(`[调度] 检查索引文件: ${readmeIndex}`);
  
  if (fs.existsSync(htmlIndex)) {
    console.log(`[调度] 找到索引文件: ${htmlIndex}`);
    await logAndRespond(urlPath, clientIp, 200, res, () => res.sendFile(htmlIndex));
    return true;
  } else if (fs.existsSync(mdIndex)) {
    // 如果存在index.md，使用Markdown处理
    console.log(`[调度] 找到索引文件: ${mdIndex}`);
    await logAndRespond(urlPath, clientIp, 200, res, () => handleMarkdownFile(mdIndex, res));
    return true;
  } else if (fs.existsSync(readmeIndex)) {
    // 如果存在README.md，使用Markdown处理
    console.log(`[调度] 找到索引文件: ${readmeIndex}`);
    await logAndRespond(urlPath, clientIp, 200, res, () => handleMarkdownFile(readmeIndex, res));
    return true;
  } else {
    // 没有找到任何索引文件
    console.log(`[调度] 未找到任何索引文件`);
    await logAndRespond(urlPath, clientIp, 404, res);
    return false;
  }
}

// 处理文件请求
async function handleFileRequest(filePath, urlPath, clientIp, res) {
  const ext = path.extname(filePath);
  
  await logAndRespond(urlPath, clientIp, 200, res, () => {
    // 如果是.md文件或者是没有扩展名但实际找到的是.md文件，则使用Markdown处理
    if (ext === '.md' || (filePath.toLowerCase().endsWith('.md') && !filePath.toLowerCase().endsWith('.md.txt'))) {
      return handleMarkdownFile(filePath, res);
    }
    
    const mimeType = mimeTypes[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', mimeType);
    res.sendFile(filePath);
  });
}

// 统一的日志记录和响应处理
async function logAndRespond(urlPath, clientIp, statusCode, res, callback) {
  const status = statusCode === 200 ? '成功' : '失败';
  console.log(`|- 文件：收到请求路径 ${urlPath}，返回${status} ${statusCode}`);
  console.log(`|- IP：${clientIp}`);
  
  try {
    const ipInfo = await getIpLocation(clientIp);
    console.log(`|- 位置：${ipInfo.location}，ISP：${ipInfo.isp}`);
  } catch (error) {
    console.log(`|- 位置：未知，ISP：未知`);
  }
  
  if (callback) {
    return callback();
  } else {
    return res.status(statusCode).end();
  }
}

// 404错误处理
app.use((req, res) => {
  console.log(`[调度] 未找到路径: ${req.originalUrl}`);
  res.status(404).end();
});

// 500错误处理
app.use((err, req, res, next) => {
  console.error(`[调度] 服务器错误:`, err);
  res.status(500).end();
});

// 启动服务器
const PORT = process.env.PORT || config.server.port || 3000;
app.listen(PORT, () => {
  // 显示漂亮的启动信息
  console.log(`================MIFENG API服务 启动信息===============`);
  console.log(`服务名称: ${config.service?.name || 'MifengAPI'}`);
  console.log(`服务描述: ${config.service?.description || 'API服务'}`);
  console.log(`页脚信息: ${config.service?.footer || '© 2025 MifengAPI'}`);
  console.log(`监听端口: ${PORT}`);
  console.log(`版本: ${config.service?.version || '1.0.0'}`);
  console.log(`API接口:`);
  config.proxies.forEach(proxy => {
    console.log(`  - 路径: /api${proxy.prefix} 描述: ${proxy.description}`);
  });
  console.log(`建站时间: ${config.service?.start_date || '未知'}`);
  console.log(`已运行: ${getRunningTime()}`);
  console.log(`======================================================`);

  // 原有的启动信息
  config.proxies.forEach(proxy => {
    console.log(`[调度] /api${proxy.prefix} → ${proxy.description} 加载成功`);
  });
});

// 处理未捕获的错误
process.on('uncaughtException', (error) => {
  console.error('[调度] 未捕获的异常:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[调度] 未处理的Promise拒绝:', reason);
});