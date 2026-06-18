# AES-CTR 文件加密工具

本地浏览器加密，文件不上传服务器，隐私安全。

## 功能

- AES-CTR 模式加密/解密
- 流式分片处理，支持大文件
- 批量文件和文件夹处理
- 队列管理，显示处理状态和进度
- 访问计数器
- iOS 兼容性检测和警告

## 在线使用

访问：https://encfile.pages.dev

## 浏览器要求

| 功能 | Chrome/Edge | Firefox | iOS Safari |
|------|-------------|---------|------------|
| 流式写入（大文件） | 支持 | 部分支持 | 不支持 |
| 内存模式（小文件 < 1GB） | 支持 | 支持 | 支持 |

iOS 系统不支持流式写入（File System Access API），大文件请使用 Chrome 或 Edge。

## 技术栈

- 前端：HTML + CSS + JavaScript（Web Crypto API）
- 后端：Cloudflare Pages Functions
- 数据库：Cloudflare D1（访问计数）
- 部署：Cloudflare Pages

## 本地开发

```bash
# 安装依赖
npm install

# 本地运行
npx wrangler pages dev public

# 部署
npx wrangler pages deploy public --project-name encfile
```

## 项目结构

```
├── public/
│   └── index.html          # 主页面
├── functions/
│   └── api/
│       └── visits.js       # 访问计数 API
├── wrangler.toml           # Cloudflare 配置
└── testAesCtr.html         # 原始版本备份
```

## 许可证

MIT
