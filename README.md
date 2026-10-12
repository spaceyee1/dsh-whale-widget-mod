# dsh whale 改版挂件

**v1.0.0** — DSH 中的小鲸鱼 AI 插话挂件，提供普通陪聊、工作模式、独立 API 配置与隐私防护。

**感谢原作者 [MeteorNOX](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget/commits?author=MeteorNOX)，以及所有上游贡献者。** 改版维护：spceyee / [spaceyee1](https://github.com/spaceyee1)。全部鸣谢见 [CREDITS.md](CREDITS.md)。

> 发布包不含 EXE 安装器和原包的 12 个图片、动图、音效文件。安装前请按 [ASSETS.md](ASSETS.md) 准备自己有权使用的素材，否则原角色和音效无法完整呈现。

## 本版能做什么

- 在 DSH 挂件气泡里，通过单独配置的 AI 接口生成简短插话。
- 提供普通陪聊和工作模式；工作模式结合检查条件、去重和完整回答状态决定是否插话。
- 配置 API 服务商、HTTPS 地址、模型和本次运行的人设；更换接收地址需要重新确认。
- 用 Windows DPAPI 的当前账户范围保存插件独立 Key，正常情况下可在同机同账户重启后恢复；恢复 Key 不会自动开始采集对话，需要点击“开始”。
- 保留角色、气泡、拖拽等已有界面代码；图片和音效需要另行准备。

当前源码固定启用 `PRIVACY_MODE=true`。旧版的余额查询与读取 DSH 主聊天 Key 的路径已禁用。因此，历史文档中的余额、记账和部分探活说明不代表这个改版当前可用的功能。

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

本次完成 **12 个 JavaScript / MJS 文件的语法检查**与来源文件校验。未执行 DSH 运行、真实 API 或安装事务测试。内部版本、完整结果和排障步骤见 [DEBUG.md](DEBUG.md)。

问题反馈：[本仓库 Issues](https://github.com/spaceyee1/dsh-whale-widget-mod/issues)。请提供脱敏错误、系统与 Harness 版本、profile 名和复现步骤，不要上传 Key、完整配置或聊天记录。

## 鸣谢与许可

原项目：[DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)。原作者 **MeteorNOX** 的版权声明与 [MIT LICENSE](LICENSE) 完整保留。全部历史贡献者及素材来源列于 [CREDITS.md](CREDITS.md)，原 [ATTRIBUTION.md](ATTRIBUTION.md)、[PROVENANCE.md](PROVENANCE.md) 和 [UPSTREAM-SOURCE.md](UPSTREAM-SOURCE.md) 继续保留。

图片、动图、音效不适用代码的 MIT 许可。本次未确认原包 12 个媒体文件在本仓库的再分发权限，因此未随包提供；详细来源及本地准备方法见 [ASSETS.md](ASSETS.md)。
