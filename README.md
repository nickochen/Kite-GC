<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/kitegc-banner-dark.png">
    <img alt="Kite Ground Control" src=".github/kitegc-banner-light.png" width="560">
  </picture>
</p>

<p align="center"><b>一款现代、跨平台的地面控制站，支持 INAV、ArduPilot 和 PX4 无人机系统</b></p>

<p align="center">
  <a href="LICENSE"><img alt="许可证: GPL-3.0" src="https://img.shields.io/badge/License-GPLv3-blue.svg"></a>
  <a href="https://b14ckyy.github.io/Kite-GC/"><img alt="文档" src="https://img.shields.io/badge/docs-online-37a8db"></a>
  <img alt="平台" src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-555">
  <img alt="状态" src="https://img.shields.io/badge/status-release%20candidate-f5a623">
  <a href="https://paypal.me/b14ckyy"><img alt="通过 PayPal 捐赠" src="https://img.shields.io/badge/Donate-PayPal-00457C?logo=paypal&logoColor=white"></a>
</p>

---

# Kite-GC 中文版

本仓库 Fork 自 [b14ckyy/Kite-GC](https://github.com/b14ckyy/Kite-GC)，已添加**简体中文翻译**（1729 条，覆盖全部 50 个模块），支持 INAV、ArduPilot、PX4 全部功能，开箱即用。

### 下载安装

👉 **[下载中文版 v1.0.0-zh](https://github.com/nickochen/Kite-GC/releases/tag/v1.0.0-zh)**

也可从 [Actions](https://github.com/nickochen/Kite-GC/actions) 页面获取最新构建产物（需手动触发构建）。

### 中文版特色

- **简体中文界面** — 菜单、提示、设置、对话框全部中文化
- **ROCWING VTOL 品牌标识** — 顶部栏添加 ROCWING 标志
- **双视频来源支持** — 支持两路独立视频流（RTSP/摄像头），可同时显示不同来源的画面，各自独立控制启停、分离浮动窗口
- **与官方版功能同步** — 基于 Kite-GC 最新代码，功能完全一致
- **已支持在设置中切换语言** — Settings → Interface → Language → 简体中文

### 中文翻译贡献

- **翻译**：nickochen (chenccr@qq.com)
- **开源仓库**：https://github.com/nickochen/Kite-GC

---

# Kite Ground Control（完整介绍）

Kite Ground Control (Kite GC) 是一款现代、跨平台的地面控制站，支持 **INAV**、**ArduPilot** 和 **PX4** 飞行器——固定翼、多旋翼、VTOL、直升机、无人车和无人船。

采用 [Tauri 2.0](https://tauri.app/)（Rust 后端）和 [Svelte 5](https://svelte.dev/)（TypeScript 前端）构建，兼具高性能与现代化的交互体验。

<p align="center">
  <img alt="Kite Ground Control 3D 模式界面" src="docs/user/assets/main_interface_3d.png" width="820">
</p>

<p align="center">
  <b><a href="https://b14ckyy.github.io/Kite-GC/">📖 文档</a></b>
  &nbsp;·&nbsp;
  <b><a href="https://github.com/b14ckyy/Kite-GC/releases">⬇️ 下载</a></b>
</p>

## 开发状态

Kite 当前处于 **功能冻结** 阶段，为 1.0 正式版做准备：

- **1.0 的 Bug 修复** → 向 **`master`** 分支提交 PR
- **新功能或功能变更** → 向 **`development`** 分支提交 PR，但需等到 1.0 正式版发布后才能合并到 master

请参阅 **[贡献指南](https://b14ckyy.github.io/Kite-GC/for-developers/contributing/)** 了解完整的分支模型。

## 亮点

- **🧊 沉浸式 3D 飞行视图** — 完整 3D 地球、真实地形、飞机和航迹 3D 显示、3D 任务覆盖层、FPV 座舱摄像头、实时昼夜光照；2D ⇄ 3D 无缝切换
- **🚁 统一 GCS，支持 INAV、ArduPilot 和 PX4** — 一套界面规划、飞行和记录全部三种飞控，支持被动监听和中继链路模式
- **🏭 机队、电池和任务管理器** — 管理飞机和电池库，含完整配置清单和生命周期统计；可复用的任务库，全部与飞行日志关联
- **⚡ 快速而直观** — 面向性能的界面设计，可停靠的小部件和面板，自动保存布局，让焦点始终在飞行上

## 基础功能

地面站应有的功能一个不少：

- **实时遥测与 HUD** — 姿态、高度、速度（含空速）、带风向和地速指示的罗盘、GPS/传感器健康、链路质量、飞行模式显示
- **可定制的小部件仪表盘** — 拖放式飞行小部件，可停靠在侧边和底部
- **2D 动态地图** — 飞机、航迹、家和任务显示，支持航向向上模式和昼夜着色
- **任务规划** — 创建、上传、下载和编辑任务，支持撤销/重做、测绘模式生成器、地形跟随/AGL 航点
- **飞行器控制** — 解锁/上锁、飞行模式切换、起飞/RTL/悬停等（ArduPilot/PX4）
- **舒适体验** — 多语言界面（英语、德语、法语、简体中文），窗口布局和设置在会话间持久保存

## Kite 的独特之处

- **全 3D 模式** — Cesium 3D 地球、真实地形、统一 3D 任务覆盖层、FPV 座舱摄像头配合保形 HUD、实时昼夜光照
- **地形感知** — AGL（离地高度）航点、任务地形剖面分析、飞行中实时 *地形雷达* / AGL 小部件
- **飞行日志** — 自动录制并支持回放，可导入 INAV 黑匣子、**ArduPilot Dataflash**、MAVLink `.tlog` 和 **MWPTools 兼容的原始 MSP** 日志——统一存储在可搜索的飞行历史中
- **机队（飞行器）管理器** — 每架飞机的配置清单（机身、动力、飞控、传感器、照片），附带生命周期统计，自动关联飞行记录；支持导出/导入 `.kvehicle`
- **电池管理器** — 按序列号追踪每块电池：循环次数、生命周期使用量和健康度，支持 `.kbatt` 导出/导入
- **安全套件** — 地理围栏（ArduPilot/PX4）、地理禁区（INAV）、安全返航点与固定翼自动降落、空域覆盖层（机场、管制空域、障碍物）以及带 ADS-B 接近预警与冲突告警的**外来飞行器雷达**
- **实时视频** — 本地采集设备（网络摄像头/USB 采集卡）或低延迟 RTSP 视频流，可在地图旁边或后方显示，一键切换地图 ⇄ 视频
- **遥测中继** — 重新编码并转发实时遥测至其他地面站、手持设备或天线跟踪器
- **RC 控制** — 使用游戏手柄/摇杆（HID）从 GCS 操控飞行器
- **RF 链路分析** — 可视化信号质量，找出最佳天线设置

## 支持的配置

- **飞控：** INAV (7.0+)、ArduPilot、PX4
- **机型：** 固定翼、飞翼、VTOL、多旋翼、直升机、无人车、无人船
- **连接：** USB/串口、蓝牙 (SPP & BLE)、TCP、UDP
- **链路模式：** 实时控制链路、**被动**监听遥测、或者**中继**广播至其他地面站
- **平台：** Windows、macOS（通用版，未签名）和 Linux（x86-64 / ARM64）。Android 和 iOS 正在开发中，将在 1.0 之后发布

## 下载

从 **[Releases](https://github.com/b14ckyy/Kite-GC/releases)** 页面下载对应平台的最新安装程序，或参考下面的源码构建指南。

> **中文版下载：** 本 fork 的 [Releases](https://github.com/nickochen/Kite-GC/releases/tag/v1.0.0-zh) 页面提供中文版安装包。

## 文档

完整文档请访问 **[b14ckyy.github.io/Kite-GC](https://b14ckyy.github.io/Kite-GC/)**：

- **入门指南：** [安装](https://b14ckyy.github.io/Kite-GC/getting-started/installation/) · [首次连接](https://b14ckyy.github.io/Kite-GC/getting-started/first-connection/) · [快速导览](https://b14ckyy.github.io/Kite-GC/getting-started/quick-tour/)
- **使用指南：** [任务规划](https://b14ckyy.github.io/Kite-GC/guides/missions/) · [遥测与显示](https://b14ckyy.github.io/Kite-GC/guides/telemetry-and-display/) · [飞行日志](https://b14ckyy.github.io/Kite-GC/guides/logbook/) · [安全](https://b14ckyy.github.io/Kite-GC/guides/safety/) · [3D 地图](https://b14ckyy.github.io/Kite-GC/guides/map-3d/) · [视频](https://b14ckyy.github.io/Kite-GC/guides/video/)
- **连接问题？** [故障排除 → 连接](https://b14ckyy.github.io/Kite-GC/troubleshooting/connection/)
- **开发者：** [概述](https://b14ckyy.github.io/Kite-GC/for-developers/) · [架构](https://b14ckyy.github.io/Kite-GC/for-developers/architecture/) · [源码构建](https://b14ckyy.github.io/Kite-GC/for-developers/building/) · [贡献指南](https://b14ckyy.github.io/Kite-GC/for-developers/contributing/)

## 支持项目发展

Kite GC 是免费开源软件，由作者在业余时间开发。如果您觉得它有用并希望支持其发展，捐款将不胜感激——谢谢！

<p align="center">
  <a href="https://paypal.me/b14ckyy"><img alt="通过 PayPal 捐赠" src="https://img.shields.io/badge/Donate%20via-PayPal-00457C?logo=paypal&logoColor=white&style=for-the-badge"></a>
</p>

## 源码构建

### 前置依赖
- [Node.js](https://nodejs.org/) LTS（v20 或 v24）
- [Rust](https://rustup.rs/)（通过 rustup 安装）
- [just](https://github.com/casey/just) — 主要任务运行器
- 平台工具链和系统依赖项——参见[构建指南](https://b14ckyy.github.io/Kite-GC/for-developers/building/)

### 开发模式
```bash
npm install      # 一次性安装
just dev         # 启动热重载开发（也可用 npm run tauri dev）
```

### 构建
```bash
just build           # 当前平台   （也可用 npm run tauri build）
just build-windows   # Windows 发布版
just build-macos     # macOS 发布版（在 macOS 上）
just build-linux     # Linux 发布版（在 Linux 上）
```

> **提示：** 安装 `just` 可获得最佳开发体验（参见项目根目录的 `justfile`）。更多细节（环境搭建、故障排除和 CI）请参阅[源码构建指南](https://b14ckyy.github.io/Kite-GC/for-developers/building/)，[架构概述](https://b14ckyy.github.io/Kite-GC/for-developers/architecture/)解释了 Kite 的整体设计。

## 贡献

欢迎提交 Issue 和 Pull Request——请参阅**[贡献指南](https://b14ckyy.github.io/Kite-GC/for-developers/contributing/)**了解分支模型和编码规范。CI 会在每个 PR 的 Windows、macOS 和 Linux 上运行 `svelte-check`、`cargo check`、clippy 和 Rust 测试。推荐 IDE：[VS Code](https://code.visualstudio.com/) 配合 [Svelte](https://marketplace.visualstudio.com/items?itemName=svelte.svelte-vscode)、[Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) 和 [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer) 扩展。

---

## Original — English

Kite Ground Control (Kite GC) is a modern, cross-platform ground control station for **INAV**, **ArduPilot** and **PX4** aircraft. This repository is a community fork with Simplified Chinese localization. The upstream project is maintained by [b14ckyy](https://github.com/b14ckyy).

## License

[GPL-3.0-or-later](LICENSE) — Copyright © 2026 Marc Hoffmann ([b14ckyy](https://github.com/b14ckyy)).