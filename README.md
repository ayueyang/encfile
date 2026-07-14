# alist-encrypt 全平台解密网页

这是 [alist-encrypt](https://github.com/traceless/alist-encrypt) 项目的易分享、全平台解密网页。无需安装客户端，通过浏览器即可在 Windows、macOS、Linux、Android 和 iOS 上解密文件，也支持加密和转分卷 ZIP。

所有加解密都在本地浏览器中完成，文件不会上传到服务器。

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

## 转压缩包

“转压缩包”主要用于 iOS Safari 等不支持流式下载（无法将处理结果持续写入本地文件）的浏览器。它相当于借助分卷压缩完成文件切割：浏览器把解密结果分成多个可逐个保存的压缩卷，WinRAR 或 7-Zip 再在解压时自动合并并恢复完整文件。

为什么需要这个模式：浏览器不能流式写入本地文件时，普通解密必须先把完整结果累积在内存中，再一次性下载。解密 10 GB 文件可能占用接近 10 GB 内存，加上输入、Blob 和浏览器缓冲后还可能更高，手机和 iOS 浏览器很容易因内存不足而崩溃。

转压缩包不会在内存中保存完整的解密结果。它每次只读取和解密 64 KB，并且只保留当前分卷；例如选择 500 MB 分卷时，主要内存占用约为当前 500 MB 分卷及少量处理缓冲，而不是完整的 10 GB 文件。

这些文件共同组成**一个连续的标准分卷 ZIP**，不是多个可以单独解压的 ZIP 文件。

处理过程：

1. 每次只读取加密文件的 64 KB 数据。
2. 按文件中的绝对位置使用所选算法解密这一块数据。
3. 将解密结果连续写入同一个 ZIP 数据流。
4. 当前卷达到设置大小后保存该卷，再继续读取和处理剩余数据。

例如，输入 `movie.mkv.chacha20` 后可能得到：

```text
movie.mkv.z01
movie.mkv.z02
movie.mkv.zip
```

恢复原文件：

1. 确保 `.z01`、`.z02` 等数据卷和最后的 `.zip` 文件完整且位于同一目录，不要单独改名。
2. 使用 WinRAR 或 7-Zip 打开最后的 `movie.mkv.zip`。
3. 正常执行解压即可恢复完整的 `movie.mkv`，不需要手工合并分卷。

支持目录写入的 Chrome/Edge 可以选择一个目录自动保存全部卷。iOS Safari、Firefox 等不支持目录写入的浏览器会在每卷生成后显示“下载本卷并继续”，必须保存当前卷后才会处理下一卷。

注意：设置的分卷大小包含 ZIP 数据和元数据。文件大小正好接近分卷边界时，最后的 ZIP 目录可能额外占用一卷。密码或算法选择错误时仍可能生成可解压但内容错误的文件，处理重要文件后应校验恢复结果。

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
│   ├── js/ciphers.js       # alist-encrypt 兼容算法层
│   ├── js/split-zip.js     # 流式标准 ZIP 分卷
│   └── vendor/             # zip.js 核心与许可证
├── functions/
│   └── api/
│       └── visits.js       # 访问计数 API
├── tests/
│   ├── ciphers.test.cjs    # 固定向量与分块回归
│   └── split-zip.test.cjs  # 标准分卷与 7-Zip 解压回归
└── wrangler.toml           # Cloudflare 配置
```

ZIP 分卷使用 [@zip.js/zip.js 2.8.29](https://www.npmjs.com/package/@zip.js/zip.js/v/2.8.29) 的 `dist/zip-core.min.js`（BSD-3-Clause）。本地文件 SHA-256 为 `FD5A95CE1C07924B036CBFDF2BEBB2BB03C78A179DA7AE8127EE70ADD6F23C66`，许可证见 `public/vendor/zipjs-LICENSE.txt`。

## 许可证

MIT
