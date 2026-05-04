# 日本旅遊日語 — 個人 PWA

N5 程度的旅遊日語學習工具：情境對話、場景單字、自我測驗。

部署：<https://yuyunu.github.io/jp-travel/>

## 三種學習模式

- **📖 情境對話** — 真實旅遊情境的對話片段（顧客 vs 店員 / 職員），漢字標 furigana，可單句／整段朗讀，可隱藏中文猜意思。
- **📚 場景單字** — 每個場景的關鍵字卡，含日文（漢字＋假名）、中文、詞性、出處例句，可標「已會 / 待加強」。
- **🎯 自我測驗** — 三種題型：聽選中、看選日、對話填空。錯題自動加入「待加強」清單，下次優先複習。

## 場景（v1 = 3 個）

✈️ 機場　🍽️ 餐廳　🏨 飯店

之後 v2 會補：飛機上、車站、拉麵店、居酒屋、便利店／藥妝、觀光景點、緊急狀況。

## 技術

- Vanilla HTML / CSS / JS，無框架
- PWA：manifest + service worker，可 Add to Home Screen，**離線完全可用**
- TTS：Web Speech API（`window.speechSynthesis`），需要設備已裝日文 voice
  - iOS：設定 → 一般 → 輔助使用 → 朗讀內容 → 語音 → 日本語
- 進度／設定：localStorage，無帳號

## Furigana 標記法

對話 / 單字的 `ja` 欄位用 `{漢字|讀音}` 標 furigana：

```
"パスポートをお{願|ねが}いします。"
```

→ 渲染成：パスポートをお<ruby>願<rt>ねが</rt></ruby>いします。
→ TTS 朗讀時自動 strip 成「パスポートをお願いします」（Japanese voice 會正確讀出）。

## 本地開發

```bash
cd jp-travel
python3 -m http.server 8080
# 開 http://localhost:8080
```

## 部署

GitHub Pages 自動部署 main 分支 root。

## 配色

| 用途 | 色 | 來源 |
|---|---|---|
| 朱赤 | `#C5302B` | 鳥居紅 |
| 紺 | `#1F3552` | 深藏青 |
| 抹茶 | `#7A8B5C` | 點綴 |
| 和紙 | `#F4ECDC` | 背景 |
| 墨 | `#2A2118` | 文字 |
| 櫻粉 | `#F5C2C7` | 強調（節制） |
