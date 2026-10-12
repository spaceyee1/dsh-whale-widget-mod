# dsh whale 改版挂件

基于 MeteorNOX 的 DSH 小鲸鱼，增加 AI 插话、独立 API 配置与隐私防护的个人改版。此仓库首版 **v1.0.0** 保存的是维护者在 2026-10-12 实际安装使用的 `0.3.16-companion.11` 源码，运行代码与内部版本号保持原样。

**感谢原作者 [MeteorNOX](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget/commits?author=MeteorNOX)，以及所有上游贡献者。** 改版由 spceyee 整理，发布账号为 [spaceyee1](https://github.com/spaceyee1)。完整名单、具体贡献与素材来源见 [CREDITS.md](CREDITS.md)。本仓库不代表上游发布、审核或合入。

> 本次发布是**源码快照**，不含 EXE 安装器，也不含原包的 12 个图片、动图和音效文件。首次克隆不能直接完整显示原角色或播放原音效；请先按 [ASSETS.md](ASSETS.md) 准备自己有权使用的素材，再安装到 DSH。源码中的素材引用仍保留原路径。

## 本版能做什么

- 在 DSH 挂件气泡里，通过单独配置的 AI 接口生成简短插话。
- 提供普通陪聊和工作模式；工作模式结合检查条件、去重和完整回答状态决定是否插话。
- 配置 API 服务商、HTTPS 地址、模型和本次运行的人设；更换接收地址需要重新确认。
- 用 Windows DPAPI 的当前账户范围保存插件独立 Key，正常情况下可在同机同账户重启后恢复；恢复 Key 不会自动开始采集对话，需要点击“开始”。
- 保留角色、气泡、拖拽等已有界面代码；图片和音效需要另行准备。

当前源码固定启用 `PRIVACY_MODE=true`。旧版的余额查询与读取 DSH 主聊天 Key 的路径已禁用。因此，历史文档中的余额、记账和部分探活说明不代表这个改版当前可用的功能。

## 版本与来源

| 项目 | 本次发布 |
|---|---|
| 仓库首版 | `v1.0.0` |
| 安装包内部版本 | `0.3.16-companion.11`，简称 `0.3.16c11` |
| 保留包名 | `dsh-whale-widget` |
| 上游基线 | MeteorNOX `v0.3.16` |
| 上游提交 | [`86af3f2d90870d14742d2083e532b98a16b7b25c`](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget/commit/86af3f2d90870d14742d2083e532b98a16b7b25c) |
| 本次来源 | 本机 DSH `web-desktop` profile 中已安装的插件；`web` profile 副本逐文件一致 |

`v1.0.0` 是本仓库首次归档的编号，不表示把内部 `0.3.16-companion.11` 升级成了另一套运行代码。为便于核对，`package.json` 中原版本和上游元数据继续保留；本改版问题请提交到[本仓库 Issues](https://github.com/spaceyee1/dsh-whale-widget-mod/issues)。

[SOURCE-SNAPSHOT.json](SOURCE-SNAPSHOT.json) 记录来源文件、SHA-256、发布路径和排除项。原安装 README 完整保存在 [docs/INSTALLED-README.md](docs/INSTALLED-README.md)，标签基线文档保存在 [UPSTREAM-README-v0.3.16.md](UPSTREAM-README-v0.3.16.md)。它们用于追溯来源、历史行为及鸣谢；**本仓库交付内容与安装限制以当前 README 为准**。

## 使用前提与安装

需要已安装 DeepSeek Harness，并确认实际使用的 profile。使用下面的 CLI 安装命令还需要 Node.js/npm 和 PATH 中可用的 `pnpm`。加密保存 Key 的实现依赖 Windows 当前账户；其它系统的兼容性没有在本次验证。

1. 下载此仓库的源码或克隆本仓库，放到固定的本地目录。
2. 阅读 [ASSETS.md](ASSETS.md)，先准备具有相应使用权的图片和音效。没有授权的原包素材不会由本仓库自动下载或补齐。
3. 保存并退出当前 DSH 会话，备份需要保留的本机插件配置。确认目标 profile 后，通过该版本 Harness 支持的本地插件安装入口，添加这个源码目录。不要安装 npm 上游 `dsh-whale-widget` 来替代本地目录，否则得到的不是本改版。
4. 重开 DSH，进入挂件的“插件 API”，配置自己的接收地址、独立 Key 与模型，核对后保存，再点击“开始”。可以先使用“测试气泡（不调用 AI）”检查界面。

在准备好素材的源码根目录打开 PowerShell，按已核对的 [Harness CLI 文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/reference/README.md) 使用本地包安装。例如目标是 `web` profile：

```powershell
$pluginPath = (Get-Location).Path.Replace('\', '/')
$pluginProfile = 'web'
npx @deepseek-ai/dsh plugin --profile $pluginProfile add "file:$pluginPath"
```

本次记录的桌面安装目录使用 `web-desktop` profile；**只有确认自己的宿主确实使用它时**，才把上面的 `$pluginProfile` 改成 `'web-desktop'`。安装完成后切回实际项目目录使用 Harness，不要从挂件源码目录启动项目任务。

需要卸载时，先确认同一个目标 profile，再移除插件：

```powershell
npx @deepseek-ai/dsh plugin --profile $pluginProfile remove dsh-whale-widget
```

桌面端和 Web 端不一定使用同一个 profile；本次快照来自 `web-desktop`，不能据此推断所有 DSH 发行版都使用这个名字。本仓库不包含旧文档提及的 EXE，也没有在发布过程中执行安装或替换现有插件。

具体的 Key 状态、模式和操作说明可参考 [COMPANION-GUIDE.md](COMPANION-GUIDE.md)；其中 EXE 安装和完整素材包描述属于旧版交付，不能套用于本仓库源码快照。

## API 与数据边界

插件会在需要时读取、解密并使用**插件独立 Key**；加密存储不等于运行时不处理 Key。获取模型或调用插话 API 时，确认的接收方会收到认证 Key 与请求内容。使用自定义反代时，该反代也会收到这些内容。

插件 Key 与 DSH 主聊天 Key 使用不同的存储和引用，本扩展不会自动把主聊天凭据附加到自己的请求中。如果在两处填写相同字符串，两处 Key 的值仍然相同。DPAPI 不能抵御已经取得同账户权限或管理员权限的恶意程序。

近期问答经过本插件的敏感信息规则检查后才用于插话，相关规则无法识别所有秘密。人设、对话缓存和气泡正文按本版设计只保留在本次运行内存中；这不代表宿主、系统或云端服务没有日志。所谓“防火墙增强”指插件自身的限制，不是 Windows 全局防火墙或绝对防泄露保证。

本仓库没有复制用户配置、Key 密文、账本、会话记录或用户自定义资源。

## 验证与排障

本次核对了安装来源、两份安装副本的一致性，确认 **22 个保留的原文件 SHA-256 不变**，并完成 **12 个 JavaScript / MJS 文件的语法检查**。没有运行 DSH、调用真实 AI 接口或执行安装事务。历史文件中的“220 项回归”属于当时的开发记录，不是本次重新执行的结果。

复现方法、核验命令和常见问题见 [DEBUG.md](DEBUG.md)。反馈问题时只提供脱敏后的错误、系统与 Harness 版本、profile 名和复现步骤，不要上传 Key、完整配置或聊天记录。

## 鸣谢与许可

原项目：[DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)。原作者 **MeteorNOX** 的版权声明与 [MIT LICENSE](LICENSE) 完整保留。全部历史贡献者及素材来源列于 [CREDITS.md](CREDITS.md)，原 [ATTRIBUTION.md](ATTRIBUTION.md)、[PROVENANCE.md](PROVENANCE.md) 和 [UPSTREAM-SOURCE.md](UPSTREAM-SOURCE.md) 继续保留。

代码许可与图片、动图、音效的权利范围不同。上游说明明确美术素材不适用代码的 MIT 许可；本次未取得足以覆盖这个公开改版仓库的再分发证明，因此没有发布这 12 个媒体文件。这是发布范围的限制，不是对原素材已侵权的判定；署名也不等于素材授权。
