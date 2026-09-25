# 极光睡眠 (SomnaCare) - 极简无干扰的睡眠记录与AI健康顾问

基于 React 19 + TypeScript + Vite + Tailwind CSS + Google Gemini 构建的极简无干扰睡眠记录、昼夜节律分析与健康顾问应用。

## 🌟 特性
- 🌙 **无干扰沉浸设计**：极简深空暗黑夜间护眼模式，支持全屏独立运行。
- 📊 **科学昼夜节律分析**：深度睡眠、REM、浅睡周期测算与入睡效率评分。
- 🤖 **AI 睡眠顾问**：结合美国国家睡眠基金会（NSF）与失眠认知行为疗法（CBT-I）准则。
- 📱 **原生 PWA & TWA**：支持 Android 原生独立安装 (WebAPK) 与 GitHub Actions 自动化 APK 构建。

## 🛠️ 本地运行

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

## 📱 自动打包 Android APK

本项目内置了 GitHub Actions 工作流文件：`.github/workflows/build-apk.yml`。

将代码推送到 GitHub 仓库后：
1. 打开仓库的 **Actions** 标签页。
2. 会自动运行 `Build Android APK` 任务。
3. 构建完成后，在任务底部的 **Artifacts** 区域即可直接下载生成的 `.apk` 安装包文件！
