<p align="center">
  <img src="docs/AppLight.png" alt="WorkShadow" width="480" />
</p>

<p align="center">
  <strong>中文</strong> | <a href="README.en.md">English</a>
</p>

<h1 align="center">WorkShadow</h1>

<p align="center">
  <strong>如影随形，记你所做，懂你想要。</strong>
</p>

WorkShadow 是一款**本地优先**的桌面工作日志应用。左侧管理你的日志，右侧用富文本编辑器记录日常的工作、决策、问题与线索。数据保存在你自己的电脑上；若需要 AI 能力（搜索、总结、问答、图片说明等），由你在设置中接入自己的模型服务——**内容在你手里，能力由你配置**。

---

## 相比常见笔记 / 文档工具，WorkShadow 适合什么？

| 常见场景 | WorkShadow 的做法 |
|----------|-------------------|
| 普通笔记软件「能写难找」 | **关键词搜索 + 语义检索**，用一句话找回几个月前的细节 |
| 写日报、周报、邮件、汇报要翻很多文件 | **工作台 · 日志总结**：勾选多篇日志，按你的要求生成各类书面草稿 |
| 「当时为什么这么决定？」 | **工作台 · 日志问答**：向自己的历史日志提问，获得更全面的归纳回答 |
| 担心工作内容上云、被平台绑定 | **数据在本地**，AI 仅在你配置模型时才联网调用 |
| 需要备份与迁移 | 支持 **`.ws` 整包备份**与合并导入 |

WorkShadow 不是替代 Word 或 Notion 的通用文档编辑器，而是面向**持续记录、回顾、汇报**的工作日志伴侣：写得顺、找得快、总结省力，且你始终掌握数据与模型选择权。

<p align="center">
  <img src="docs/Home.png" alt="WorkShadow 主界面" width="900" />
</p>

---

## 安装版与开发版

**[安装版](https://github.com/FutureUniant/WorkShadow/releases/download/v0.1.1/WorkShadow_x64-setup.exe)**（Releases 安装包）与 **[开发版](https://github.com/FutureUniant/WorkShadow/releases/download/v0.1.1/WorkShadow_0.1.1_x64-dev-setup.exe)**（`npm run tauri dev` 或下载开发版安装包）核心功能相同，**均免费**。安装版对程序做了专项优化，编辑更**丝滑、流畅**；并额外提供智能补全与新手引导（✅ 有 / ❌ 无）：

| 对比项 | [开发版](https://github.com/FutureUniant/WorkShadow/releases/download/v0.1.1/WorkShadow_0.1.1_x64-dev-setup.exe) | [安装版](https://github.com/FutureUniant/WorkShadow/releases/download/v0.1.1/WorkShadow_x64-setup.exe) | 备注 |
|--------|:------:|:------:|------|
| 费用 | 🆓 | 🆓 | |
| 核心功能 | ✅ | ✅ | |
| 编辑性能优化 | ❌ | ✅ | 更丝滑、流畅的编辑体验 |
| 更友好、更美观的 UI 交互界面 | ❌ | ✅ | 更顺手的日常使用体验 |
| 图像复制、拖拽 | ❌ | ✅ | 支持粘贴 / 拖拽插入图片 |
| 智能补全 | ❌ | ✅ | 本地，越用越智能 |
| 新手引导 | ❌ | ✅ | |
| 数据在本地 | ✅ | ✅ | |
| 获取 | [下载](https://github.com/FutureUniant/WorkShadow/releases/download/v0.1.1/WorkShadow_0.1.1_x64-dev-setup.exe) / 源码启动 | [下载](https://github.com/FutureUniant/WorkShadow/releases/download/v0.1.1/WorkShadow_x64-setup.exe) | |
| 适合 | 开发调试 | 日常使用 | |

补全与引导均在本地学习，不上传日志；AI 能力由你在设置中自行配置。

---

## 主要功能

### 日志组织与编辑

- **智能补全**（仅 **[安装版](https://github.com/FutureUniant/WorkShadow/releases/download/v0.1.1/WorkShadow_x64-setup.exe)**）：编辑时根据你本地已保存的日志，在光标处给出续写建议；数据在本机学习与推断，不上传正文，**用得越久、记录越多，建议越贴合你的写法**。[开发版](https://github.com/FutureUniant/WorkShadow/releases/download/v0.1.1/WorkShadow_0.1.1_x64-dev-setup.exe)不包含此功能。
- **富文本编辑**：标题、列表、任务清单、引用、代码块、表格、链接、图片、视频、公式等常用格式一应俱全。
- **图像复制、拖拽**（仅 **[安装版](https://github.com/FutureUniant/WorkShadow/releases/download/v0.1.1/WorkShadow_x64-setup.exe)**）：支持从剪贴板粘贴图片，或将图片文件拖入编辑区插入。[开发版](https://github.com/FutureUniant/WorkShadow/releases/download/v0.1.1/WorkShadow_0.1.1_x64-dev-setup.exe)不包含此功能。
- **批量操作**：多选节点后批量移动或删除，整理大量历史日志更省力。
- **导入 Markdown**：可将已有 `.md` 文件导入到某条日志中继续编辑。

### 搜索与理解

- **关键词搜索**：在左侧搜索框输入词语，对日志正文做本地关键词匹配，结果展示多处命中片段，点击即可打开对应日志。
- **语义搜索**：配置嵌入模型后，可用自然语言描述意图进行向量检索，找到「意思相近但措辞不同」的内容；未配置时自动退化为关键词搜索。

### 工作台（AI 辅助，需自行配置模型）

- **记忆**：存放跨多篇日志仍成立的约定（如 OKR 口径、术语含义、总结侧重），供总结与问答时参考。
- **日志总结**：勾选多篇日志，结合「记忆」与你的写法偏好（关注点、语气、结构等），按需生成**日报、周报、月报、邮件、阶段汇报、项目报告**等各类书面内容草稿，可直接复制后微调发送。
- **日志问答**：针对你的问题，从全部日志中检索相关片段并归纳作答，比单篇翻阅更**全面、连贯**，适合回顾决策背景、梳理进展、核对细节；回答会标注参考来源。

### 设置与数据

- **界面**：浅色 / 深色主题，中 / 英文（可跟随系统），界面缩放可调。
- **路径**：自定义日志落盘目录与临时文件目录；保存时可将正文写入你指定的文件夹。
- **模型配置**：分别配置大语言模型（总结、问答）、多模态模型（图片 / 视频说明）、嵌入模型（语义搜索）；支持连接测试。
- **快捷键**：应用内快捷键与系统级「新建子日志」快捷键可自定义。
- **数据导入 / 导出**：将日志、记忆、设置等打包为 `.ws` 文件备份，或从备份合并恢复。

---

## 如何使用（桌面版）

### 方式一：安装版

直接下载 **[安装版](https://github.com/FutureUniant/WorkShadow/releases/download/v0.1.1/WorkShadow_x64-setup.exe)**（`WorkShadow_x64-setup.exe`），或前往 [Releases 发布页](https://github.com/FutureUniant/WorkShadow/releases/tag/v0.1.1) 查看全部资源。安装完成后从开始菜单或桌面快捷方式启动即可。以下为安装后的日常使用说明。

#### 1. 首次打开

1. 启动 WorkShadow。
2. 点击右上角 **设置**，建议先完成：
   - **基本设置**：选择主题、语言、日志保存目录。
   - **模型配置**（可选）：若要用语义搜索、日志总结、日志问答或图片 AI 说明，填写对应模型的地址、密钥与模型名，并 **测试连接**。
3. 点击左上角 **返回** 回到主界面。

#### 2. 写日志

1. 在左侧选中文件夹或日志；搜索框下方可 **新建日志**。
2. 在右侧编辑区写作；需要时用工具栏插入表格、图片、链接等。
3. 点击 **保存**（或编辑区焦点下按 `Ctrl+S` / `⌘+S`）：内容写入本地数据库，并按设置导出到日志目录、更新检索索引。

#### 3. 整理与查找

- **整理**：右键节点可新建子节点、重命名、移动、复制、删除；也可拖拽移动；**批量操作** 可一次处理多个节点。
- **查找**：左侧搜索框输入内容后搜索；配置嵌入模型后，可切换 **语义** 模式做自然语言检索。
- **工作台**：点击侧栏 **工作台**，在「记忆」「日志总结」「日志问答」之间切换使用（总结与问答需已配置大语言模型）。

#### 4. 备份与迁移

在 **设置 → 数据** 中，将所需内容 **导出为 `.ws` 文件**；在新环境 **从 `.ws` 文件导入** 即可合并恢复（未勾选导出的类别不会被覆盖）。

### 方式二：开发版（安装包或源码）

也可直接下载 **[开发版](https://github.com/FutureUniant/WorkShadow/releases/download/v0.1.1/WorkShadow_0.1.1_x64-dev-setup.exe)**（`WorkShadow_0.1.1_x64-dev-setup.exe`）安装使用，无需配置下方开发环境。

若希望从源码启动，适合开发者或希望直接运行仓库代码的用户。需先准备：

- **Node.js** 18 及以上（推荐当前 LTS）
- **Rust + Cargo**（Tauri 桌面壳依赖）
- Windows 上还需安装 **Visual Studio「使用 C++ 的桌面开发」** 工作负载（详见 [Tauri 前置条件](https://v2.tauri.app/start/prerequisites/)）

在项目根目录执行：

```bash
npm install
npm run tauri dev
```

第一条命令安装前端依赖；第二条会**先启动 Vite 开发服务器**（默认 `http://localhost:1420`），再编译并打开 Tauri 桌面窗口，窗口内直接加载开发地址，改前端代码后通常可热更新，无需每次重新打包。

若 `1420` 端口已被占用，请先关闭其它占用该端口的进程后再试。

> 说明：`npm run tauri dev` 用于本机开发调试，**不会**生成可分发的安装包。若要打正式安装包，需执行 `npm run build` 后再 `npm run tauri build`，产物一般在 `src-tauri/target/release/bundle/` 目录。

启动成功后，**日常使用与方式一相同**，请参照上文方式一中「首次打开」至「备份与迁移」的说明操作。

---

## 联系我们

如有问题、建议或合作意向，欢迎通过以下方式联系。应用内也可在 **设置 → 关于** 查看相同二维码。

<p align="center">
<table>
  <tr>
    <td align="center" width="33%">
      <img src="docs/wechat.jpg" alt="管理员微信二维码" width="168" /><br />
      <strong>管理员微信</strong><br />
      <sub>扫码添加，便于反馈与交流</sub>
    </td>
    <td align="center" width="33%">
      <img src="docs/wechat_public.jpg" alt="微信公众号二维码" width="168" /><br />
      <strong>微信公众号</strong><br />
      <sub>扫码关注，获取产品动态</sub>
    </td>
    <td align="center" width="33%">
      <img src="docs/qq_group.jpg" alt="WorkShadow QQ 群二维码" width="168" /><br />
      <strong>QQ 群</strong><br />
      <sub>扫码加入群聊；群号 <strong>1107536375</strong></sub>
    </td>
  </tr>
</table>
</p>

<p align="center">
  <strong>电子邮箱</strong>：<a href="mailto:feiyangtech@qq.com">feiyangtech@qq.com</a>
</p>

---

## 开源与许可

本仓库以 **[GNU Affero General Public License v3.0（AGPL-3.0）](https://www.gnu.org/licenses/agpl-3.0.html)** 发布。

- 你可以自由使用、研究、修改和分发本软件。
- 若你修改本软件并通过网络提供服务，须向用户提供对应源代码（AGPL 的 copyleft 要求）。
- 本软件包含的第三方依赖，分别适用其各自的开源许可证。
