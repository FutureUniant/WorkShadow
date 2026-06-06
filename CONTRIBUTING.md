# 参与贡献 WorkShadow

<p align="center">
  <strong>中文</strong> | <a href="CONTRIBUTING.en.md">English</a>
</p>

感谢你对 [WorkShadow](https://github.com/FutureUniant/WorkShadow) 的关注！WorkShadow 是一款**本地优先**的桌面工作日志应用（Tauri 2 + React + TypeScript + Rust）。无论你是修复 Bug、改进文档、完善国际化，还是参与检索与 AI 相关能力，我们都欢迎你的参与。

请先阅读本指南；行为准则见 [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)（[English](./CODE_OF_CONDUCT.en.md)）。

---

## 你可以如何贡献

| 方式 | 说明 |
|------|------|
| **报告问题** | 通过 [GitHub Issues](https://github.com/FutureUniant/WorkShadow/issues) 提交缺陷、体验问题或功能建议 |
| **提交代码** | Fork 仓库 → 创建分支 → 提交 Pull Request |
| **改进文档** | 修正 README、补充开发说明、完善注释 |
| **翻译与文案** | 项目使用 i18n（中/英），欢迎校对与新增语言 |
| **参与讨论** | QQ 群（1107536375）、微信公众号，或邮件 [feiyangtech@qq.com](mailto:feiyangtech@qq.com) |

国内用户也可在 [AtomGit / GitCode 镜像](https://gitcode.com/FutureUniant/WorkShadow) 提交 Issue 或 PR；建议以 **GitHub 为主仓** 进行代码合并。

---

## 开始之前

1. **搜索已有 Issue / PR**，避免重复劳动。
2. **较大改动请先开 Issue 讨论**（新功能、架构调整、破坏性变更），确认方向后再写代码。
3. **遵守 [AGPL-3.0](./LICENSE)**：若你修改并通过网络提供服务，须向用户提供对应源代码。
4. **不要提交敏感信息**：API Key、个人日志、`.ws` 备份、本地数据库等切勿进入仓库。

---

## 开发环境

### 要求

- **Node.js** 18+（推荐当前 LTS）
- **Rust + Cargo**（桌面版 `tauri dev` / `tauri build` 需要）
- **Windows**：打包与原生编译需安装 Visual Studio「**使用 C++ 的桌面开发**」工作负载，详见 [Tauri 前置条件](https://v2.tauri.app/start/prerequisites/)

### 克隆与安装

```bash
git clone https://github.com/FutureUniant/WorkShadow.git
cd WorkShadow
npm install
```

### 常用命令

| 命令 | 用途 |
|------|------|
| `npm run dev` | 仅浏览器调试前端（无 Tauri，数据走 `localStorage`） |
| `npm run tauri dev` | 启动桌面开发模式（Vite HMR + Tauri 窗口） |
| `npm run build` | 构建前端静态资源到 `dist/` |
| `npm run tauri build` | 打 Release 安装包（需先能成功 `build`） |
| `npm test` | 运行 Vitest 单元测试 |
| `npm run preview` | 预览生产构建的前端 |

**说明：**

- `npm run tauri dev` 不会生成安装包，适合日常联调；改 React/TS/CSS 可走热更新，改 Rust 或 `tauri.conf.json` 会触发重新编译。
- 若 `1420` 端口被占用，请先关闭其它占用进程。
- 直接运行 `target/debug` 下的 exe 时，需保证 `dist/` 已由 `npm run build` 生成，否则可能出现白屏。

### 项目结构（简览）

```
WorkShadow/
├── src/                 # React 前端（组件、服务、i18n）
├── src-tauri/           # Rust 原生层（SQLite、LanceDB、系统能力）
├── docs/                # 文档与配图
├── scripts/             # 图标同步、打包辅助脚本
└── assets/              # 站点与展示资源
```

核心模块参考：

- **编辑**：TipTap 富文本 ↔ Markdown（`src/` 编辑器相关）
- **检索**：关键词 + 语义搜索（`src/services/rag.ts` 等）
- **持久化**：SQLite 状态、LanceDB 向量（`src-tauri/`）
- **工作台**：记忆、日志总结、日志问答（`src/services/` 下相关服务）

---

## 提交 Issue

好的 Issue 能显著加快处理速度。请尽量包含：

1. **环境**：操作系统与版本、WorkShadow 版本（安装版 / 开发版 / 源码 commit）
2. **复现步骤**：从启动到出现问题的最短路径
3. **期望与实际**：你期望发生什么，实际发生了什么
4. **截图或日志**：UI 问题请附图；崩溃或白屏请附 Console / 终端报错（**请脱敏**）
5. **是否可稳定复现**

功能建议请说明**使用场景**与**为何对 WorkShadow 有价值**，而非仅描述「想要某某功能」。

---

## 提交 Pull Request

### 分支与提交

1. 从 `main`（或当前默认分支）拉取最新代码。
2. 使用有意义的分支名，例如：
   - `fix/search-highlight-jump`
   - `feat/i18n-ja-locale`
   - `docs/contributing-guide`
3. 保持每个 PR **聚焦单一主题**；无关改动请拆分为独立 PR。
4. 提交信息建议采用简洁祈使句，例如：
   - `fix: 修复语义搜索最低相似度未生效`
   - `feat: 工作台总结支持自定义输出模板`
   - `docs: 补充模型配置存储说明`

### 代码与风格

- 使用 **TypeScript**，遵循仓库现有目录与命名习惯。
- 修改前端时，注意 **i18n**：用户可见文案放入语言包，避免硬编码中文/英文。
- 涉及 **Tauri invoke** 时，同步检查 Rust 侧命令签名与错误处理。
- 涉及 **Embedding / LanceDB** 时，注意索引重建语义，避免破坏已有用户数据兼容性。
- 优先**小步、可审查的 diff**；避免大规模无关格式化。
- 新逻辑若适合单元测试，请在 `src/**/*.test.ts` 中补充；运行 `npm test` 确保通过。

### PR 描述建议包含

- **变更摘要**（做了什么、为什么）
- **关联 Issue**（`Fixes #123` / `Closes #123`）
- **测试说明**（你如何验证：命令、手动步骤、截图）
- **破坏性变更**（若有，请明确列出迁移方式）

维护者可能会在 Review 中提出修改；请及时回应或更新分支。

---

## 许可与版权

- 本仓库以 **[AGPL-3.0](./LICENSE)** 发布。
- 向本仓库贡献的代码，视为你在相同许可下授权项目使用。
- 引入新的第三方依赖前，请确认许可证与 AGPL 兼容，并在 PR 中说明。

---

## 获取帮助

- **GitHub Issues**：[github.com/FutureUniant/WorkShadow/issues](https://github.com/FutureUniant/WorkShadow/issues)
- **项目主页**：[futureuniant.github.io/WorkShadow](https://futureuniant.github.io/WorkShadow/)
- **邮件**：[feiyangtech@qq.com](mailto:feiyangtech@qq.com)
- **QQ 群**：1107536375（README 中有二维码）

再次感谢你的贡献。WorkShadow 的目标是帮用户**写下来、找回来、说清楚**——每一位参与者都在让这个闭环变得更好。
