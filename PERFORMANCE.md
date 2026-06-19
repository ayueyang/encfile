# 加密性能优化分析

## 当前性能

5GB 文件加密约 1 分钟（~85MB/s），已接近磁盘读写速度上限。

## 优化方向一：Web Worker 并行加密

### 原理
多个 Worker 同时处理不同分片，利用多核 CPU 加速。

### 风险

| 风险项 | 说明 |
|--------|------|
| 代码复杂度大增 | 需要把加密逻辑抽到独立 worker 文件，主线程和 worker 之间用 `postMessage` 传递数据，涉及 ArrayBuffer 转移、错误传递、进度同步 |
| 多文件架构问题 | 当前是单 HTML 文件，Web Worker 需要独立 JS 文件，要么用 Blob URL 创建 inline worker（调试困难），要么拆分文件结构 |
| 内存峰值翻倍 | N 个 Worker 并行 = N 倍内存占用。5GB 文件用 4 Worker，峰值内存可能到 8-10GB，反而可能 OOM |
| 收益不确定 | Web Crypto 底层可能已经用硬件加速（AES-NI），瓶颈可能在磁盘 I/O 而非 CPU，并行不一定更快 |
| 浏览器兼容性 | Worker 中 `crypto.subtle` 在部分浏览器受限 |

### 结论
风险高，收益不确定，不建议当前阶段实施。

## 优化方向二：WASM 替代 Web Crypto

### 原理
用 WASM 实现 AES-CTR，可能更快且支持真正的流式加密。

### 风险

| 风险项 | 说明 |
|--------|------|
| 需要引入第三方 WASM 库 | 增加 HTML 体积和依赖，如 `libsodium.js`（~200KB）或自编译 WASM |
| 不一定比 Web Crypto 快 | Web Crypto 直接调用系统 AES-NI 硬件指令，WASM 即使有 SIMD 支持也很难超越原生 |
| 流式加密仍受限 | WASM 可以做到流式处理，但需要重写整个加密流程，工作量巨大 |
| 安全性风险 | 自定义加密实现可能有漏洞，Web Crypto 是浏览器内置的安全实现，经过严格审计 |
| 维护成本 | WASM 库更新、兼容性、调试都更复杂 |

### 结论
安全性风险高，维护成本大，不建议实施。

## 当前方案评估

单 HTML 文件 + Web Crypto 是最稳定可靠的方案：

- **安全性**：浏览器内置实现，经过严格审计
- **兼容性**：Chrome/Edge/Firefox 均支持
- **维护性**：单文件，无外部依赖
- **性能**：85MB/s 已接近磁盘 I/O 上限，优化空间有限

如未来浏览器支持 `crypto.subtle.encrypt` 的流式 API（如 TransformStream），可无缝升级。
