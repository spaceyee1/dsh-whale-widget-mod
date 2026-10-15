# dsh whale 改版挂件

**v1.0.2** — DSH 中的小鲸鱼挂件，提供账户余额、账本、AI 插话、工作模式与独立 API 配置。

**感谢原作者 [MeteorNOX](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget/commits?author=MeteorNOX)，以及所有上游贡献者。** 改版维护：spceyee / [spaceyee1](https://github.com/spaceyee1)。全部鸣谢见 [CREDITS.md](CREDITS.md)。

> 发布包不含 EXE 安装器和原包的 12 个图片、动图、音效文件。安装前请按 [ASSETS.md](ASSETS.md) 准备自己有权使用的素材，否则原角色和音效无法完整呈现。

## v1.0.2：账户余额与 AI 插话可同时使用

- 余额只调用 DSH 的 `deepseekAccount.getBalance()`，由宿主处理账户登录凭据；插件不读取主聊天 `DEEPSEEK_API_KEY`，查询失败也不回退读 Key。
- 恢复账本、消费记录、余额预警、今日预算及余额校正。记录金额、时间、模型和 Token 数，不把会话正文或标题加入账本。余额差是账户范围的观测，不是单次请求费用；充值与余额调整仍需核对。
- 使用独立能力策略控制账户余额、账本、API Key 余额、旧凭据编辑、Codex 扫描等。后面三项仍禁用，AI 插话隐私检查不变。
- `x-dshw-companion` 仅是路由标记，不作为身份凭证；本机连接、Host、Origin、Fetch-Site 及宿主认证检查继续生效。
- 查询账户切换和迟到回复有保护。没有稳定账户标识时仍显示余额，但暂停余额差记账；账本无法写入时不展示上一账户统计，也不允许错误校正。
- 菜单显示 `v1.0.2`，账户余额提示与插话 API 提示分开。旧余额凭据表单及账户模式不支持的订阅额度编辑不再开放。
- 修复 DeepSeek 官方域名在 TUN 代理下解析为 `198.18/15` 时被误拦截的问题。仅允许精确官方域名使用此映射，仍校验证书与域名，自定义地址的限制保持不变。

**使用账户余额：**在 DSH 宿主里登录 DeepSeek 账户，再刷新小鲸鱼余额。必须是提供该账户服务的宿主版本。只向进程传入 API Key，并不等于已登录账户；不支持账户服务时插件会明确提示。

**使用 AI 插话：**仍按下面步骤填写插件独立 API。账户余额不依赖插话的 Windows DPAPI 初始化；Linux/Web 的账户服务也按同一接口调用，但此版本未新增 Linux 插话密钥存储支持，未在反馈者电脑验证实际联网。

验证方法与限制见 [v1.0.2 更新说明](docs/RELEASE-v1.0.2.md)。

## 保留的 API 配置修复

旧“添加模型 / 密钥接口”入口现在直接打开“插件 API”，不再让用户填写已禁用的余额表单。无需填写凭据名或币种。更新后重新启动 DSH，在“插件 API → 配置 API”选择服务商、填写 Key、确认目标地址并保存；获取或填写模型后再次保存，最后点击“开始”。DeepSeek 预设使用 `https://api.deepseek.com`，不要把其它协议的完整接口地址填入该预设。

现有目的地确认、独立密钥保存及隐私检查保持启用。本次修复不代表已在反馈者电脑验证实际联网。

## 本版能做什么

- 在 DSH 挂件气泡里，通过单独配置的 AI 接口生成简短插话。
- 提供普通陪聊和工作模式；工作模式结合检查条件、去重和完整回答状态决定是否插话。
- 配置 API 服务商、HTTPS 地址、模型和本次运行的人设；更换接收地址需要重新确认。
- 用 Windows DPAPI 的当前账户范围保存插件独立 Key，正常情况下可在同机同账户重启后恢复；恢复 Key 不会自动开始采集对话，需要点击“开始”。
- 保留角色、气泡、拖拽等已有界面代码；图片和音效需要另行准备。

当前策略定义在 `lib/capabilities.mjs`。账户余额与账本启用，旧 API Key 余额、宿主凭据编辑、探活和 Codex 日志扫描仍禁用。历史文档若与这里冲突，以本 README 和 v1.0.2 更新说明为准。

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

桌面端与 Web 端可能使用不同的 profile。如果自己的宿主使用 `web-desktop`，将 `$pluginProfile` 改成 `'web-desktop'`。安装完成后切回实际项目目录使用 Harness，不要从挂件源码目录启动项目任务。

需要卸载时，先确认同一个目标 profile，再移除插件：

```powershell
npx @deepseek-ai/dsh plugin --profile $pluginProfile remove dsh-whale-widget
```

Key 状态、模式和操作说明见 [COMPANION-GUIDE.md](COMPANION-GUIDE.md)。该文档中的 EXE 和完整素材包属于历史交付，安装方式与文件范围以本 README 为准。

## API 与数据边界

插件会在需要时读取、解密并使用**插件独立 Key**；加密存储不等于运行时不处理 Key。获取模型或调用插话 API 时，确认的接收方会收到认证 Key 与请求内容。使用自定义反代时，该反代也会收到这些内容。

插件 Key 与 DSH 主聊天 Key 使用不同的存储和引用，本扩展不会自动把主聊天凭据附加到自己的请求中。如果在两处填写相同字符串，两处 Key 的值仍然相同。DPAPI 不能抵御已经取得同账户权限或管理员权限的恶意程序。

近期问答经过本插件的敏感信息规则检查后才用于插话，相关规则无法识别所有秘密。人设、对话缓存和气泡正文按本版设计只保留在本次运行内存中；这不代表宿主、系统或云端服务没有日志。所谓“防火墙增强”指插件自身的限制，不是 Windows 全局防火墙或绝对防泄露保证。

本仓库没有复制用户配置、Key 密文、账本、会话记录或用户自定义资源。

## 验证与排障

本次 **31 项回归测试通过**，并经授权使用真实 Key 验证了当前插件的 DeepSeek API 客户端：取得 2 个模型、调用 `deepseek-flash` 一次并得到 `OK`，用量为 11 个输入 Token 和 1 个输出 Token。测试 Key 仅在内存中使用，未写入文件。账户余额通过模拟宿主验证；尚未在反馈者电脑实测账户服务或安装事务。结果与限制见 [v1.0.2 更新说明](docs/RELEASE-v1.0.2.md)，历史排障记录见 [DEBUG.md](DEBUG.md)。

问题反馈：[本仓库 Issues](https://github.com/spaceyee1/dsh-whale-widget-mod/issues)。请提供脱敏错误、系统与 Harness 版本、profile 名和复现步骤，不要上传 Key、完整配置或聊天记录。

## 鸣谢与许可

原项目：[DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)。原作者 **MeteorNOX** 的版权声明与 [MIT LICENSE](LICENSE) 完整保留。全部历史贡献者及素材来源列于 [CREDITS.md](CREDITS.md)，原 [ATTRIBUTION.md](ATTRIBUTION.md)、[PROVENANCE.md](PROVENANCE.md) 和 [UPSTREAM-SOURCE.md](UPSTREAM-SOURCE.md) 继续保留。

图片、动图、音效不适用代码的 MIT 许可。本次未确认原包 12 个媒体文件在本仓库的再分发权限，因此未随包提供；详细来源及本地准备方法见 [ASSETS.md](ASSETS.md)。
