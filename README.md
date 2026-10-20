<p align="center"><img src="build/icon.png" width="96" alt="不记Todo 图标"></p>

# 不记Todo

贴在 Mac 桌面上的轻量待办。随手记下，抬眼看见。

**[下载最新版 Mac 安装包](https://github.com/yexinyu907/buji-todo/releases/latest)** · [更新记录](CHANGELOG.md) · [反馈问题](https://github.com/yexinyu907/buji-todo/issues)

## 下载与安装

当前版本 **0.8.4**，支持 **macOS 12 及以上**，Universal 安装包同时包含 Apple Silicon 和 Intel 架构。

1. 下载 [buji-todo-0.8.4-mac-universal.zip](https://github.com/yexinyu907/buji-todo/releases/download/v0.8.4/buji-todo-0.8.4-mac-universal.zip)。
2. 解压后，将「不记Todo.app」拖入「应用程序」。
3. 打开应用，点击右上角「＋」开始记录。更新已有版本时，先退出应用再替换，原有待办保存在独立的数据目录中。

当前公开包使用本地签名，尚未经过 Apple 开发者签名和公证。首次打开可能被 macOS 拦截；请确认下载来源，按系统提示在「系统设置 → 隐私与安全性」中允许打开。

## 能做什么

- **桌面常驻**：置顶、折叠，支持登录时启动和显示／隐藏窗口快捷键。
- **快速记录**：优先级、日期和时刻、每天／每周循环、标签、备注、图片与链接。
- **列表与日历**：按优先级、截止时间或标签整理；同一天的全天任务排在具体时刻之后，无日期任务排在最后。
- **苹果提醒事项同步**：选择手机常用的 iCloud 清单，确认首次合并后自动双向同步。
- **不记Todo提醒**：到点弹窗，可完成或稍后提醒；默认六只小猫，也可在小图库中上传多张形象，每次随机展示。
- **按习惯调整外观**：字号、卡片间距、透明度、浅色预设与自定义颜色。
- **文件导入与导出**：ZIP 包含全部未完成、已完成待办及图片。导入前确认替换，导入后暂停苹果同步，核对后再连接。

## 和 iPhone 一起用

在「设置 → 数据与提醒」连接苹果提醒事项，选择同一 Apple 账号下的 iCloud 清单。首次仅合并未完成任务，同名任务由你决定合并或独立保留。

之后新增、编辑、完成和删除会自动交换。两边同时修改同一字段时，应用会请你确认。Mac 上的不记Todo需要保持运行，手机与 Mac 之间的传播由 iCloud 完成。

苹果通知继续由系统负责；同步任务是否额外显示不记Todo弹窗，可在设置中选择。卡片上的铃铛控制单条任务的本机弹窗。

详见 [提醒事项同步说明](APPLE_SYNC_GUIDE.md)。

## 数据与隐私

不需要注册不记Todo账号，也没有额外的同步服务器。未连接苹果提醒事项时，待办保存在这台 Mac；连接后，所选清单的同步字段通过苹果提醒事项进入你的 iCloud。

本地数据位于 `~/Library/Application Support/buji-todo/`。上传的提醒形象只保存为本机副本，不修改原图。源码和安装包不包含开发者的待办、图片、图库、账号凭据或本机配置。

应用只在获取链接标题、手动检查 GitHub 更新、打开外部链接及使用苹果同步等相应功能时联网。不会使用 AI 读取或判断你的任务。

## 从源码运行

需要 macOS、Node.js 22 或更高版本，以及 Xcode Command Line Tools。

```bash
git clone https://github.com/yexinyu907/buji-todo.git
cd buji-todo
npm ci
npm start
```

首次运行会编译苹果提醒事项的原生连接模块。如未安装命令行开发工具，可先运行 `xcode-select --install`。

```bash
npm test          # 自动化测试
npm run pack     # 构建本机架构的 .app
npm run dist     # 构建 Universal Mac ZIP
```

界面使用原生 HTML、CSS、JavaScript，桌面框架为 Electron；任务使用本地 JSON 和图片文件，苹果同步通过 macOS EventKit 实现。当前自动化界面验证在 Apple Silicon Mac 完成，Intel 架构已包含在 Universal 包中，尚未进行 Intel 实机验证。

## 项目

这是一个通过 Vibe Coding 持续迭代的小项目，目标是让记录待办足够轻、桌面提示足够直观。欢迎通过 [Issues](https://github.com/yexinyu907/buji-todo/issues) 提交建议；反馈时请隐去个人任务、截图中的隐私信息和账号凭据。

作者：[yexinyu907](https://github.com/yexinyu907)
