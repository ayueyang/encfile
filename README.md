# 文件加密工具

本地浏览器加密，文件不上传服务器，隐私安全。

## 功能

- AES-CTR（默认）、CHACHA20、RC4（废弃）加密/解密
- 解密并转换为分卷 ZIP，支持三种算法
- 流式分片处理，支持大文件
- 批量文件和文件夹处理
- 队列管理，显示处理状态和进度
- 访问计数器
- iOS 兼容性检测和警告

## 文件格式

| 算法 | 加密文件后缀 | 说明 |
|------|--------------|------|
| AES-CTR | `.ctr` | 默认，与 alist-encrypt 兼容 |
| CHACHA20 | `.chacha20` | 与 alist-encrypt 兼容 |
| RC4 | `.rc4` | 已废弃，仅用于兼容旧文件 |

解密和转压缩包会根据已知后缀自动选择算法。无已知后缀的文件使用页面当前选择的算法，并保留原文件名。

## 在线使用

访问：https://encfile.pages.dev

## 浏览器要求

| 功能 | Chrome/Edge | Firefox | iOS Safari |
|------|-------------|---------|------------|
| 流式写入（大文件） | 支持 | 部分支持 | 不支持 |
| 内存模式（小文件 < 1GB） | 支持 | 支持 | 支持 |

iOS/iPadOS 不支持流式写入（File System Access API），页面会提示使用“转压缩包”。微信、QQ 等内置浏览器不支持时，请在系统 Chrome 或 Edge 中打开。受限浏览器仍可用内存模式处理小文件。

## 技术栈

- 前端：HTML + CSS + JavaScript（Web Crypto API）
- 后端：Cloudflare Pages Functions
- 数据库：Cloudflare D1（访问计数）
- 部署：Cloudflare Pages

## 本地开发

```bash
# 本地运行
npx wrangler pages dev public --compatibility-date 2026-06-23

# 部署
npx wrangler pages deploy public --project-name encfile
```

## 项目结构

```
├── public/
│   ├── index.html          # 主页面
│   └── js/ciphers.js       # alist-encrypt 兼容算法层
├── functions/
│   └── api/
│       └── visits.js       # 访问计数 API
├── tests/
│   └── ciphers.test.cjs    # 固定向量与分块回归
└── wrangler.toml           # Cloudflare 配置
```

## 许可证

MIT
