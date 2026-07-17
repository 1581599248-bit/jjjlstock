# GitHub 与 Render 部署

## 自动更新方式

全市场季度数据保存在 `public/data`，每个季度使用独立目录；`app/data/published-periods.json` 只登记已经通过完整校验的季度。GitHub Actions 每周一、周四北京时间约 10:17 检查东方财富是否出现下一财报期。

只有同时满足以下条件才会提交新季度：

1. 跨基金公司的样本披露率达到 90%。
2. 全市场基金公司、基金经理、基金产品、规模、持仓、行业和股票反查数据全部生成成功。
3. 与上一季度相比，核心数量指标没有异常大幅下降。
4. 网站及 Excel 导出测试全部通过。

成功提交后，旧季度目录不会被删除，网站财报期下拉框会同时保留历史季度。

## GitHub 设置

1. 将整个项目推送到 GitHub，默认分支建议使用 `main`。
2. 打开仓库的 `Settings → Actions → General → Workflow permissions`。
3. 选择 `Read and write permissions`，允许定时任务提交新季度数据。
4. 在 `Actions → Quarterly holdings refresh` 中可使用 `Run workflow` 手动检查；通常不需要填写财报期。

项目不需要 iFind 账号或密钥，也不要把任何账号、密码、令牌写入仓库。

## Render 设置

1. 在 Render 中选择 `New → Blueprint`，连接这个 GitHub 仓库。
2. Render 会读取根目录的 `render.yaml`，创建 Node Web Service。
3. 保持自动部署为 `On Commit`。GitHub 定时任务提交一个通过校验的新季度后，Render会自动重新构建并上线。

Render只运行网站，季度数据由GitHub生成并永久记录在Git历史中，因此不依赖Render的临时磁盘。免费Render Web Service长时间无人访问会休眠，首次打开可能需要等待冷启动；如果要求任何时刻都快速打开，需要改用付费常驻实例。
