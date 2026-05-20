# 不记Todo

> 一个贴在桌面上的智能便利贴 —— 不需要打开、不需要切换、抬眼就能看到，一键就能记录。

## 下载使用

**普通用户直接下载即可，不需要懂代码：**

- **Mac 用户**：下载 [不记Todo-0.6.1-universal-mac.zip](https://github.com/yexinyu907/buji-todo/releases)，解压后双击打开即可（应用图标在屏幕顶部菜单栏）
- **Windows 用户**：下载 [不记Todo-0.6.1-win.zip](https://github.com/yexinyu907/buji-todo/releases)，解压后双击运行，无需安装

> 如果 Releases 页面还没有文件，可以联系作者获取安装包。

## 功能特色

- 🖥️ **桌面常驻悬浮** — 开机自启、始终置顶，像便利贴一样贴在桌面
- ⚡ **极速添加** — 点击加号，输入文字，回车完成，3秒搞定
- 🐱 **小猫DDL提醒** — 到点弹出可爱小猫提醒你，支持「完成」和「稍后提醒」
- 🎡 **时间滚轮选择器** — 滑动选择时间，流畅自然
- 📅 **日历视图** — 月历鸟瞰 + 日期详情，看清时间分布
- 🔗 **智能链接识别** — 粘贴 URL 自动显示标题
- 🔁 **重复待办** — 每天/每周自动出现，完成后次日重置
- 🎨 **优先级颜色** — 紧急红色、重要橙色、普通蓝色
- 💬 **智能问候语** — 根据时段和任务量显示不同暖心文案
- 🔒 **零账号零网络** — 纯本地存储，隐私安全

## 开发者指南

如果你想自己修改代码或从源码运行：

```bash
# 1. 克隆仓库
git clone https://github.com/yexinyu907/buji-todo.git
cd buji-todo

# 2. 安装依赖
npm install

# 3. 运行
npm start

# 4. 打包（可选）
# Mac:
npx electron-builder --mac
# Windows:
npx electron-builder --win
```

## 技术栈

- Electron（桌面应用框架）
- 纯原生 HTML/CSS/JavaScript（无前端框架）
- 本地 JSON 文件存储

## 项目背景

这是一次 **非程序员通过 AI（Vibe Coding）从零做出可分发产品** 的实验。从需求定义、开发、调试到打包分发，全程由产品经理与 AI（CatDesk）对话协作完成。

## 作者

yexinyu · y1416154606@163.com
