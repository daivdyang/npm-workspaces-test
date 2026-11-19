# npm Workspaces 與共用組件整合指南

## 目錄

1. [npm workspaces 功能詳解](#1-npm-workspaces-功能詳解)
2. [npm 如何判斷套件是本地還是外部](#2-npm-如何判斷套件是本地還是外部)
3. [既有專案加載外部共用組件（Vue / Nuxt）](#3-既有專案加載外部共用組件vue--nuxt)
4. [React / Next.js 專案的差異](#4-react--nextjs-專案的差異)
5. [workspace 套件改參照遠端 repo](#5-workspace-套件改參照遠端-repo)

---

## 1. npm workspaces 功能詳解

npm workspaces 是 npm 從 v7 開始內建的 monorepo 支援，讓你在**同一個 Git 倉庫、同一個根目錄**裡管理多個 npm 套件，並由 npm 自動處理它們之間的相依與安裝。

### 1.1 它解決什麼問題

假設有一個 Nuxt 前端專案，另外還有一個共用的 UI 元件庫和一個存放多語系翻譯檔的套件。沒有 workspaces 時，常見做法是：

- 分成多個倉庫各自發佈到 npm registry：每改一次元件庫就要發版，再到主專案更新版本。
- 用 `npm link` 手動建立連結：容易壞、無法寫進設定，換一台電腦就要重做。

workspaces 的核心想法是：**把本地資料夾當成套件，由 npm 用符號連結（symlink）自動接起來**，而且所有相依都集中在根目錄用一份 `package-lock.json` 管理。

### 1.2 基本結構與設定

```
my-platform/
├── package.json          ← 根目錄（workspace root）
├── package-lock.json     ← 只有一份
├── node_modules/
├── apps/
│   └── web/              ← Nuxt 應用程式
│       └── package.json  (name: "@acme/web")
└── packages/
    ├── ui/               (name: "@acme/ui")
    └── i18n/             (name: "@acme/i18n")
```

根目錄的 `package.json`：

```json
{
  "name": "my-platform",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "devDependencies": {
    "typescript": "^5.6.0",
    "eslint": "^9.0.0"
  }
}
```

- `workspaces` 是一組 glob 路徑，每個符合且有 `package.json` 的資料夾都會被當成一個 workspace。
- 根目錄建議設 `"private": true`，避免不小心把整個倉庫發佈出去。
- 共用的開發工具（TypeScript、ESLint、Prettier）通常放在根目錄的 `devDependencies`。

要讓 `@acme/web` 使用 `@acme/ui`，在 `apps/web/package.json` 裡照常宣告即可：

```json
{
  "name": "@acme/web",
  "dependencies": {
    "@acme/ui": "*",
    "@acme/i18n": "*"
  }
}
```

> **注意：** npm **不支援** pnpm 和 Yarn 的 `"workspace:*"` 協定，寫了會出現 `EUNSUPPORTEDPROTOCOL` 錯誤。npm 裡要用 `"*"` 或實際的版本範圍。

### 1.3 執行 `npm install` 時發生了什麼

在根目錄執行 `npm install`，npm 會做三件事：

1. **合併解析**：讀取所有 workspace 的 `package.json`，把整棵相依樹合併起來一起解析。
2. **提升（hoist）**：能共用的第三方套件盡量裝在根目錄的 `node_modules`。若兩個 workspace 需要互相衝突的版本（例如 `lodash@3` 與 `lodash@4`），其中一個提升到根目錄，另一個裝在該 workspace 自己的 `node_modules`。
3. **建立符號連結**：

```
node_modules/@acme/ui   →  ../../packages/ui
node_modules/@acme/i18n →  ../../packages/i18n
node_modules/@acme/web  →  ../../apps/web
```

因為 Node.js 解析模組時會一路往上層目錄找 `node_modules`，所以 `apps/web` 裡的 `import { Button } from '@acme/ui'` 會找到根目錄的連結，最後指向 `packages/ui` 的原始碼。修改 `packages/ui` 後，`apps/web` 立即生效，不需要重新安裝或發版。

### 1.4 常用指令

| 旗標 | 說明 |
|---|---|
| `-w` / `--workspace` | 指定一個或多個 workspace（可用套件名稱或資料夾路徑） |
| `-ws` / `--workspaces` | 對所有 workspace 執行 |
| `--if-present` | 沒有該 script 的 workspace 直接略過 |
| `--include-workspace-root` | 連根目錄一起執行 |

```bash
# 對特定 workspace 安裝套件（寫進該 workspace 的 package.json）
npm install primevue -w @acme/ui
npm install -D vitest -w apps/web

# 移除
npm uninstall lodash -w @acme/ui

# 執行特定 workspace 的 script
npm run dev -w @acme/web

# 同時指定多個
npm run test -w @acme/ui -w @acme/i18n

# 在所有 workspace 執行 build；沒有 build script 的就略過
npm run build -ws --if-present

# 連根目錄也一起執行
npm run lint -ws --include-workspace-root

# 建立新的 workspace（產生資料夾與 package.json，並加入設定）
npm init -w packages/utils

# 在某個 workspace 的情境下執行工具
npm exec -w @acme/web -- nuxi typecheck

# 查看 workspace 之間的相依關係
npm ls --workspaces
```

在 `apps/web` 目錄內直接執行 `npm install xxx`，npm 會往上找到根目錄並認出這是 workspace，結果與在根目錄加 `-w` 相同，lock 檔也只會更新根目錄那一份。

### 1.5 限制與常見陷阱

**執行順序不是依相依關係排序。**
`npm run build -ws` 依照 `workspaces` 設定與資料夾比對的順序**依序**執行，不會自動分析「`web` 依賴 `ui`，所以 `ui` 要先 build」。解法：

- 在 `workspaces` 陣列裡手動排序（例如 `"packages/*"` 放在 `"apps/*"` 前面）。
- 搭配 Turborepo 或 Nx，取得拓撲排序、平行執行與快取。

**幽靈相依（phantom dependencies）。**
因為提升機制，`apps/web` 即使沒宣告 `dayjs`，只要其他 workspace 裝了它，`import 'dayjs'` 一樣能動。單獨部署或拆出去時就會壞。可用 ESLint 的 `import/no-extraneous-dependencies` 把關，或改用 pnpm 的嚴格隔離。

**本地套件的進入點。**
共用套件的 `main` / `exports` 指向哪裡很重要：

- 指向 `src/index.ts`：開發最方便，免編譯、改了即時生效。Vite（Nuxt 底層）會把不在 `node_modules` 裡的連結套件當成原始碼處理；若沒被轉譯，可在 Nuxt 的 `build.transpile` 加上套件名稱。
- 指向 `dist`：套件要發佈到 registry 時需要，並須在發佈流程中先 build。

**`node_modules` 位置不固定。**
套件可能在根目錄，也可能在 workspace 自己的資料夾。不要寫死 `../../node_modules/xxx`，改用 `require.resolve` 或讓工具自行解析。

**版本與發佈。**
npm 可用 `npm version patch -w @acme/ui` 與 `npm publish -w @acme/ui` 處理單一套件，但沒有「依變更自動決定要發哪些套件、同步更新互相引用版本」的機制，通常交給 Changesets。

### 1.6 與 pnpm、Yarn 比較

| 工具 | 優點 | 缺點 |
|---|---|---|
| npm | 不需額外安裝、最單純 | 無 `workspace:` 協定、預設提升造成幽靈相依、指令不做拓撲排序 |
| pnpm | 內容定址儲存，安裝快、省空間；嚴格 `node_modules` 擋掉幽靈相依；`pnpm -r run build` 依相依順序執行 | 需額外安裝 |
| Yarn (Berry) | 功能最多 | Plug'n'Play 模式與部分工具相容性需額外調整 |

專案規模中等、不想引入新工具時，**npm workspaces + Turborepo** 是很常見的組合。

---

## 2. npm 如何判斷套件是本地還是外部

關鍵在於：npm 不是先判斷「這是本地還是外部」，而是**先把所有 workspace 放進相依樹，再用一般的模組解析規則去找，找到的剛好是本地的那個就用它**。整個過程由 npm 內部負責建構相依樹的模組 Arborist 處理。

### 2.1 解析三步驟

**步驟一：建立「名稱 → 路徑」對照表。**
npm 讀取根目錄 `workspaces` glob，展開成實際資料夾，再讀每個資料夾的 `package.json`。這裡用的是 **`name` 欄位，不是資料夾名稱**。例如 `packages/ui` 裡寫 `"name": "@acme/ui"`，對照表就是 `@acme/ui → packages/ui`。兩個 workspace 用同一個名稱會直接報錯。

**步驟二：把 workspace 以連結節點放進相依樹根層。**
在解析任何相依之前，先在理想相依樹的根目錄 `node_modules` 放好連結：

```
node_modules/@acme/ui    → link → packages/ui
node_modules/@acme/i18n  → link → packages/i18n
```

**步驟三：用一般規則解析每一條相依。**
處理 `apps/web` 宣告的 `"@acme/ui": "*"` 時，npm 照 Node.js 的方式往上層 `node_modules` 找同名套件，找到根層的連結節點後，用該 workspace 的 `version` 比對宣告的範圍（semver）：

```
packages/ui/package.json:  "version": "1.2.0"

apps/web 宣告 "@acme/ui": "*"       → 1.2.0 符合 → 使用本地連結
apps/web 宣告 "@acme/ui": "^1.0.0"  → 1.2.0 符合 → 使用本地連結
apps/web 宣告 "@acme/ui": "^2.0.0"  → 不符合    → 去 registry 抓 2.x，
                                                  裝在 apps/web/node_modules 裡
```

版本不符時 npm **不會報錯**，而是當成一般版本衝突處理：

- registry 上沒有這個套件 → `E404`
- registry 上剛好有同名套件 → **悄悄裝到外部的那個**

> **注意 prerelease 版本：** 依 semver 規則，`1.0.0-beta.1` 這類版本不一定會被 `*` 或 `^1.0.0` 涵蓋。本地套件沒被連結時，可以先檢查這點。

### 2.2 從 lock 檔辨識

```json
"node_modules/@acme/ui": {
  "resolved": "packages/ui",
  "link": true
},
"packages/ui": {
  "name": "@acme/ui",
  "version": "1.2.0",
  "dependencies": { "primevue": "^4.0.0" }
},
"node_modules/primevue": {
  "version": "4.2.1",
  "resolved": "https://registry.npmjs.org/primevue/-/primevue-4.2.1.tgz",
  "integrity": "sha512-..."
}
```

| 類型 | 特徵 |
|---|---|
| 本地 workspace | `"link": true`，`resolved` 為相對路徑 |
| 外部套件 | `resolved` 為 registry 網址，帶有 `integrity` 雜湊值 |

### 2.3 實務建議

- **workspace 一律用 scope 命名**（如 `@acme/ui`），不要取 `ui`、`utils`、`i18n` 這類通用名稱。因為比對只看名稱和版本，本地版本不符時 npm 可能抓到公開 registry 上別人發佈的同名套件，這正是「相依混淆（dependency confusion）」攻擊利用的漏洞。
- 想**明確**使用本地路徑而不靠名稱比對，可寫 `"@acme/ui": "file:../../packages/ui"`，npm 不做版本比對，直接連結。不過在 workspaces 裡通常不需要，用版本範圍反而能在套件之後發佈到 registry 時保持一致。

---

## 3. 既有專案加載外部共用組件（Vue / Nuxt）

選擇方式主要取決於兩件事：

- **共用組件的原始碼放在哪裡**（同一個倉庫還是獨立倉庫）
- **有幾個專案要用、改動多頻繁**

以下依「改動既有專案的幅度」由小到大介紹。

### 3.1 方式一：發佈成私有套件

把共用組件放在獨立倉庫，build 後發佈到私有 registry（GitHub Packages、GitLab Package Registry、npm 私有 scope 或自架 Verdaccio），既有專案像裝一般套件一樣安裝，結構完全不用動。

在專案根目錄加 `.npmrc`：

```ini
@acme:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NPM_TOKEN}
```

```bash
npm install @acme/ui
```

- **優點：** 版本清楚、可回退，CI 與部署流程不需特殊處理，多專案共用最穩定。
- **缺點：** 改一個按鈕就要走「改組件庫 → 發版 → 專案升版」流程，迭代慢。
- **適合：** 組件庫已相對穩定，或由另一個團隊維護。

### 3.2 方式二：直接從 Git 安裝

```json
"dependencies": {
  "@acme/ui": "github:acme/ui#v1.2.0"
}
```

- 私有倉庫用 `git+ssh://git@github.com/acme/ui.git#v1.2.0`，安裝環境（含 CI）須有 SSH 金鑰。
- npm 從 Git 安裝拿到的是原始碼。需要編譯時，組件庫要設定 `prepare` script（npm 安裝時會自動執行），或把 `dist` 一併提交。
- **優點：** 設定成本最低。
- **缺點：** 安裝較慢、無法使用 semver 範圍（只能釘死 tag）。
- **適合：** 過渡期或小團隊。

### 3.3 方式三：Nuxt Layers（Nuxt 專案最推薦評估）

Layer 本身就是一個迷你 Nuxt 專案，可包含 `components/`、`composables/`、`app.config.ts`、`nuxt.config.ts`，甚至多語系檔。被繼承後組件會**自動 import**，設定會自動合併。

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  extends: [
    '@acme/ui-layer',                                       // 從 npm / 私有 registry
    // ['github:acme/ui-layer#v1.2.0', { install: true }],  // 或直接從 Git
    // '../shared/ui-layer',                                // 或本地路徑
  ],
})
```

- 來源可以是 npm 套件、Git 倉庫或本地路徑，能與方式一、二、四搭配。
- 私有 Git 倉庫用 `GIGET_AUTH` 環境變數提供 token；`install: true` 會安裝 layer 自己的相依。
- Layer 裡的 `.vue` 檔由 Nuxt 以原始碼編譯，組件庫不需要另外的 build 流程。
- 共用內容若包含 PrimeVue 主題設定、composables、翻譯檔，Layers 能一次帶進來。

### 3.4 方式四：將既有專案轉成 monorepo

組件庫與專案由同一團隊維護、經常需要同時修改時適用。

```bash
mkdir -p apps packages
git mv <原本專案的檔案> apps/web/     # 用 git mv 保留歷史紀錄
# 在根目錄建立新的 package.json，設定 workspaces
# 把組件庫放進 packages/ui
rm -rf node_modules package-lock.json apps/web/node_modules apps/web/package-lock.json
npm install
```

- 需調整：CI 路徑、部署設定的工作目錄、Dockerfile 的 COPY 步驟。
- 組件庫原本在另一個倉庫時，可用 `git subtree add` 或 `git merge --allow-unrelated-histories` 連同歷史併入。
- **優點：** 開發體驗最好，改了立即生效，一次 PR 同時改兩邊。
- **缺點：** 遷移成本最高；組件庫若要給 monorepo 以外的專案使用，仍須回到方式一發佈。

### 3.5 方式比較

| 方式 | 改動既有專案 | 迭代速度 | 版本管理 | 適合情境 |
|---|---|---|---|---|
| 私有 registry | 幾乎不用 | 慢（需發版） | 完整 semver | 多專案共用、組件庫穩定 |
| Git 安裝 | 幾乎不用 | 中 | 只能釘 tag | 不想架 registry、過渡期 |
| Nuxt Layers | 改 `nuxt.config` | 依來源而定 | 依來源而定 | Nuxt 專案、共用內容不只組件 |
| Monorepo | 結構重整 | 快 | 需另外處理 | 同團隊維護、常需同時修改 |

### 3.6 開發組件庫時的本地連結

採用方式一或二時，開發組件庫的當下需要讓專案即時看到改動：

- `npm link` 在 Vue 專案容易出現**兩份 Vue 實例**（組件庫的符號連結讀到它自己 `node_modules` 裡的 Vue），症狀是 `inject()` 拿不到值、PrimeVue 主題或設定失效。
- 建議改用 **`yalc`**，模擬真正的發佈與安裝而非建立符號連結。
- 或在 Vite 設定加入 `resolve.dedupe: ['vue', 'primevue']`。

### 3.7 不論哪種方式都要處理的三件事

**1. 框架套件宣告為 peerDependencies**

`vue`、`primevue`、`vue-i18n` 等框架層套件放 `peerDependencies`，讓組件庫使用專案端那一份。PrimeVue 的設定與主題透過 provide/inject 傳遞，對雙實例尤其敏感。

```json
"peerDependencies": {
  "vue": "^3.5.0",
  "primevue": "^4.0.0"
}
```

**2. Tailwind 要掃描組件庫的檔案**

Tailwind v4 自動偵測會略過 `node_modules`，需在 CSS 入口明確加入：

```css
@import "tailwindcss";
@source "../node_modules/@acme/ui";
```

Tailwind v3 則在 `tailwind.config` 的 `content` 陣列加上路徑。使用 Nuxt Layers 時，Nuxt 的 Tailwind 模組通常會自動納入 layer 目錄，但仍建議實際確認。

**3. 原始碼還是編譯後的檔案**

- 以 `.vue` / `.ts` 原始碼發佈：專案端可能需在 `nuxt.config` 的 `build.transpile` 加上套件名稱。
- 以編譯好的 `dist` 發佈：不需轉譯，但要確認 CSS 有一併匯出。

### 3.8 建議

使用端都是 Nuxt 專案時，優先考慮 **Nuxt Layer + 私有 registry 發佈**：既有專案只改一行 `extends`，版本可控；日後若轉 monorepo，同一個 layer 改成本地路徑引用即可，不用重寫。

---

## 4. React / Next.js 專案的差異

大方向與 Vue / Nuxt 相同（私有 registry、Git 安裝、monorepo 皆適用），但有三個關鍵差異：

- **沒有 Nuxt Layers 這種機制**
- **App Router 引入了伺服器組件的邊界**
- **React 生態多了「複製原始碼」的分發方式**

### 4.1 沒有 Layers，但有 Just-in-Time 套件

Next.js 沒有能合併設定、自動註冊組件的繼承機制，共用組件就是一般 npm 套件，必須明確 import。最接近 Layers「免 build」優點的做法，是讓組件庫直接匯出 TypeScript 原始碼，由 Next.js 編譯（Turborepo 文件稱之為 Just-in-Time 套件）：

```json
// packages/ui/package.json
{
  "name": "@acme/ui",
  "exports": {
    "./button": "./src/button.tsx",
    "./dialog": "./src/dialog.tsx"
  },
  "peerDependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  }
}
```

```ts
// next.config.ts
const nextConfig = {
  transpilePackages: ['@acme/ui'],
}
export default nextConfig
```

- `transpilePackages` 是 Next.js 內建設定（取代過去的 `next-transpile-modules`）。沒加的話，Next.js 不會編譯 `node_modules` 或 workspace 裡的 TS / JSX，會直接報語法錯誤。
- 此做法在 monorepo 內最方便；若要發佈給 monorepo 以外的專案，對方也得設定 `transpilePackages`，因此對外發佈時通常 build 成 JS（tsup 或 Vite library mode）。

### 4.2 App Router 的 `"use client"` 問題

App Router 預設所有組件都是伺服器組件。使用 `useState`、`useEffect`、事件處理或瀏覽器 API 的組件，檔案開頭必須有 `"use client"`。

**打包工具可能刪掉指令。**
Rollup 類工具把多個檔案合併成一個 bundle 時，會把檔案頂端的指令字串視為無用程式碼移除，導致專案端出現「hooks 只能在客戶端組件使用」之類的錯誤。解法：

- 保留模組結構（每個原始檔對應一個輸出檔），例如 Rollup 的 `preserveModules`。
- 搭配能保留指令的外掛，例如 `rollup-plugin-preserve-directives`。
- 或採用 Just-in-Time 方式直接匯出原始碼，就沒有此問題。

**避免單一 barrel file 同時匯出客戶端與伺服器組件。**

- `index.ts` 頂端加 `"use client"` → 所有匯出都變客戶端組件，失去伺服器組件的好處。
- 不加 → 裡面的互動組件會出錯。
- 建議用 `exports` 子路徑讓每個組件有獨立入口：`import { Button } from '@acme/ui/button'`，同時改善 tree-shaking。
- 一定要保留 barrel file 時，可用 Next.js 的 `experimental.optimizePackageImports` 減輕載入整包的成本。

**CSS-in-JS 限制。**
執行期 CSS-in-JS（styled-components、Emotion）無法在伺服器組件中運作，使用它們的組件都必須是客戶端組件。新的組件庫在 Next.js 生態多半改用 Tailwind 或 CSS Modules。

### 4.3 React 雙實例：Invalid hook call

與 Vue 雙實例問題相同，但 React 會直接拋出 `Invalid hook call` 錯誤。處理方式：

- `react` 與 `react-dom` 一律放 `peerDependencies`。
- 本地開發組件庫時用 `yalc` 而非 `npm link`。
- 純 React + Vite 專案可加 `resolve.dedupe: ['react', 'react-dom']`。

### 4.4 React 生態特有選項：shadcn 式原始碼分發

不把組件當相依套件安裝，而是**把原始碼複製進專案**，由專案自己擁有並修改。shadcn/ui CLI 支援自訂 registry，可把團隊共用組件做成 registry（一組描述組件檔案與相依的 JSON）：

```bash
npx shadcn add https://ui.acme.internal/r/button.json
```

- **優點：** 沒有版本相依、雙實例、`transpilePackages` 與 `"use client"` 打包問題，各專案可自由客製。
- **缺點：** 組件庫更新不會自動同步，需重新拉取並手動合併差異。
- **適合：** 「提供一致起點、允許各專案分歧」的設計系統。
- **不適合：** 需嚴格統一行為的組件（例如投注單、金額輸入等邏輯必須一致的元件）。

### 4.5 轉成 monorepo 時的 Next.js 注意事項

- Next.js + Turborepo 是最常見組合，`npx create-turbo@latest` 產生的範本（`apps/web` + `packages/ui`）可直接參考。
- 使用 `output: 'standalone'` 打包 Docker 映像時，須將 `outputFileTracingRoot` 設為 monorepo 根目錄，否則 workspace 套件不會被包進輸出。
- 部署到 Vercel 時，在專案設定把 Root Directory 指到 `apps/web`。

### 4.6 Nuxt 與 Next.js 對照

| 項目 | Nuxt | Next.js |
|---|---|---|
| 組件繼承機制 | Layers（`extends`） | 無，一般 import |
| 編譯 workspace 原始碼 | 多數情況自動，必要時 `build.transpile` | 必須設定 `transpilePackages` |
| 框架套件放置 | `vue`、`primevue` 放 peerDependencies | `react`、`react-dom` 放 peerDependencies |
| 雙實例症狀 | inject 失效、PrimeVue 設定遺失 | `Invalid hook call` |
| 特有問題 | 自動 import 名稱衝突 | `"use client"` 邊界與打包 |
| Tailwind 掃描 | `@source` 或模組自動處理 | `@source` 指向組件庫 |

### 4.7 建議

| 情境 | 建議做法 |
|---|---|
| 組件庫只給內部幾個專案用 | monorepo + Just-in-Time 套件 + `transpilePackages` |
| 發佈給團隊外部或多個獨立倉庫 | build 成保留模組結構的 JS，發佈到私有 registry |
| 設計系統希望各專案能自由調整 | shadcn 式 registry |

---

## 5. workspace 套件改參照遠端 repo

先區分兩種需求：

| 需求 | 是否可行 |
|---|---|
| workspace 裡的某個 app 不用本地 `@acme/ui`，改用遠端 repo 版本 | ✅ 可以，只需改相依宣告 |
| `workspaces` 設定本身指向遠端 repo（如 `"workspaces": ["github:acme/ui"]`） | ❌ 不行，`workspaces` 只接受本地資料夾的 glob 路徑 |

### 5.1 情況一：改相依宣告指向遠端

```json
// apps/web/package.json
"dependencies": {
  "@acme/ui": "github:acme/ui#v1.2.0"
}
```

依照第 2 節的解析機制：npm 先在根目錄找到本地 workspace 的連結節點，但 Git 規格只有在來源與 commit 相符時才算「滿足」，本地連結不符合，因此 npm 從遠端抓取，**裝在 `apps/web/node_modules/@acme/ui`**。lock 檔記錄實際 commit：

```json
"apps/web/node_modules/@acme/ui": {
  "resolved": "git+ssh://git@github.com/acme/ui.git#3f9c2a1...",
  ...
}
```

- 之後 `npm install` 會沿用此 commit。
- 要更新就改 tag 後重新安裝，或執行 `npm update @acme/ui -w @acme/web`。
- 改成私有 registry 上本地版本不滿足的範圍（例如本地 `1.x`、宣告 `^2.0.0`），結果相同：遠端版本裝在較深層。

**注意：倉庫內會同時存在兩份 `@acme/ui`。**
若 `packages/ui` 仍在 `workspaces` 範圍內，根目錄連結仍指向本地，其他沒改宣告的 workspace 照樣用本地版，只有 `apps/web` 用遠端版。編輯器跳轉定義、TypeScript 型別解析可能指到另一份，造成除錯困擾。

若目的是**整個倉庫都改用遠端版本**：

```bash
# 1. 從 workspaces 移除（或刪掉／搬出 packages/ui 資料夾）
# 2. 所有使用端改宣告遠端位址
# 3. 清掉舊的連結與 lock 重新安裝
rm -rf node_modules package-lock.json
npm install
```

**Git 相依的限制：**

- npm 從 Git 安裝拿到的是原始碼，需要編譯時，組件庫要有 `prepare` script，或使用端以 `transpilePackages` / `build.transpile` 處理。
- **npm 目前沒有原生支援安裝 Git 倉庫中的某個子資料夾。** 若遠端 repo 本身是 monorepo，`@acme/ui` 位於其 `packages/ui`，npm 無法用 Git 位址指到該處（pnpm 和 Yarn 有對應語法，npm 沒有），此時請改從 registry 發佈與安裝。

### 5.2 情況二：讓遠端 repo 成為 workspace 成員

若希望遠端 repo 的程式碼出現在倉庫中，並享有 workspace 的即時連結，必須先把它變成本地資料夾。

**Git submodule**

```bash
git submodule add git@github.com:acme/ui.git packages/ui
npm install
```

- 對 npm 來說就是普通資料夾，`workspaces` 的 glob 照樣比對得到。
- **優點：** 兩個倉庫各自獨立，組件庫的提交與發版流程不受影響。
- **缺點：** 操作門檻較高，clone 時要加 `--recurse-submodules`、CI 要初始化 submodule，團隊成員常忘記更新 submodule 指標。

**Git subtree**

- 把遠端 repo 的內容（連同歷史）直接併入 `packages/ui`，之後用 `git subtree pull` 拉更新、`git subtree push` 推回去。
- **優點：** 對其他開發者而言就是普通資料夾，沒有 submodule 的操作負擔。
- **缺點：** 同步指令較繁瑣。
- **適合：** 主要在 monorepo 開發，偶爾同步回原倉庫。

### 5.3 實務建議

若需求是「平常使用遠端穩定版，偶爾在本地修改組件庫並即時看效果」，與其在 workspace 與遠端之間反覆切換宣告，建議：

1. 專案相依固定指向私有 registry 或 Git tag，組件庫保持獨立倉庫。
2. 需要本地開發時用 `yalc` 暫時替換。
3. 改完再發版。

如此 `package.json` 與 lock 檔不會因切換而來回變動，CI 也永遠使用確定的版本。