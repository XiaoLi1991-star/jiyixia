# 记一下

一个本地优先的 Android 流水账 App。V1 使用 React、Vite、Capacitor 开发，支持随手记 Excel 导入、AI 文字转草稿、流水管理、月度统计、年度统计和 JSON 备份。

## 开发

```bash
npm install
npm run dev
```

## 验证

```bash
npm run check
npm test
npm run build
npx cap sync android
```

## AI 隐私边界

AI 快速记录只发送本次输入和本地分类表，不发送历史流水。AI 输出先进入草稿，用户确认后才会写入正式流水。
