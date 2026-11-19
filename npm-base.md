# npm 套件設定筆記

## 目錄

1. [`npm pack` 指令詳解](#1-npm-pack-指令詳解)
2. [package.json 的 `engines` 欄位](#2-packagejson-的-engines-欄位)
3. [package.json 的 `main` 與 `exports`](#3-packagejson-的-main-與-exports)

---

## 1. `npm pack` 指令詳解

### 基本概念

`npm pack` 會把目前的套件打包成一個 `.tgz` 壓縮檔（tarball）。它的內容和執行 `npm publish` 時上傳到 npm registry 的檔案**完全一樣**，只是不會真的發佈，而是把檔案存在本機。所以它常被當成「發佈前的預演」，也很適合在本機測試套件。

```bash
npm pack
```

執行後會在目前目錄產生 `<套件名稱>-<版本號>.tgz`。例如 `package.json` 中 `name` 是 `my-ui-lib`、`version` 是 `1.2.0`，就會產生 `my-ui-lib-1.2.0.tgz`。如果是 scoped 套件，例如 `@win/ui`，`@` 會被移除、`/` 會換成 `-`，檔名變成 `win-ui-1.2.0.tgz`。

### 執行時的輸出

終端機會列出打包結果，大致如下：

```
npm notice 📦  my-ui-lib@1.2.0
npm notice Tarball Contents
npm notice 1.1kB package.json
npm notice 2.3kB README.md
npm notice 45.6kB dist/index.mjs
npm notice 12.0kB dist/style.css
npm notice Tarball Details
npm notice name:          my-ui-lib
npm notice version:       1.2.0
npm notice filename:      my-ui-lib-1.2.0.tgz
npm notice package size:  15.2 kB
npm notice unpacked size: 61.0 kB
npm notice shasum:        3f2a...
npm notice integrity:     sha512-...
npm notice total files:   4
my-ui-lib-1.2.0.tgz
```

這份清單是最重要的檢查依據。你可以從這裡確認 `dist/` 有沒有被包進去，也能看出是否混入了測試檔、`.env` 或原始碼之類不該發佈的東西。

### 哪些檔案會被打包？

npm 依照以下規則決定內容，優先順序由高到低。

**`package.json` 的 `files` 欄位（白名單，最推薦）**：只有列出的檔案或資料夾會被打包。

```json
{
  "files": ["dist", "types"]
}
```

**`.npmignore`（黑名單）**：沒有設定 `files` 時，npm 會排除 `.npmignore` 中列出的檔案。

**`.gitignore`**：如果連 `.npmignore` 都沒有，npm 會改用 `.gitignore`。這是常見陷阱：`dist/` 通常寫在 `.gitignore` 裡，結果打包出來的套件沒有建置產物。用 `files` 白名單可以避開這個問題。

不論怎麼設定，有些檔案**一定會被包含**：`package.json`、`README`、`LICENSE`／`LICENCE`，以及 `main` 和 `bin` 欄位指向的檔案。

另外有些檔案**一定會被排除**：`.git`、`node_modules`（`bundleDependencies` 列出的除外）、`.npmrc`、`package-lock.json`、`.DS_Store` 等。

### 常用選項

| 選項 | 說明 |
|---|---|
| `--dry-run` | 只列出會被打包的檔案，不產生 `.tgz`，適合快速檢查 |
| `--json` | 以 JSON 格式輸出打包資訊，方便在 CI 或腳本中解析 |
| `--pack-destination <目錄>` | 指定 `.tgz` 的輸出位置，例如 `--pack-destination ./artifacts` |
| `--ignore-scripts` | 不執行 `prepack`、`prepare`、`postpack` 等生命週期腳本 |
| `-w <名稱>` / `--workspace` | 在 monorepo 中打包指定的 workspace |
| `--workspaces` | 打包所有 workspace |

```bash
# 只檢查內容，不產生檔案
npm pack --dry-run

# 打包到指定資料夾
npm pack --pack-destination ./artifacts

# monorepo 中打包特定子套件
npm pack -w packages/ui
```

### 打包遠端套件

`npm pack` 後面也可以接 registry 上的套件名稱。這時它會把那個套件的 tarball 下載到本機，不需要安裝：

```bash
npm pack vue@3.5.0
tar -tzf vue-3.5.0.tgz
```

想查看某個第三方套件實際發佈了哪些檔案時，這招很好用。

### 生命週期腳本

執行 `npm pack` 時，會依序觸發 `prepack` → `prepare` → `postpack`。通常會把建置步驟放在 `prepack`，確保打包前一定是最新的建置結果：

```json
{
  "scripts": {
    "build": "vite build",
    "prepack": "npm run build"
  }
}
```

### 主要用途：在本機測試套件

這是 `npm pack` 最實用的情境。假設你在開發一個 Vue 元件庫，想在另一個 Nuxt 專案中測試：

```bash
# 在元件庫專案中
npm pack

# 在 Nuxt 專案中安裝這個 tarball
npm install ../my-ui-lib/my-ui-lib-1.2.0.tgz
```

`package.json` 會記錄成：

```json
"dependencies": {
  "my-ui-lib": "file:../my-ui-lib/my-ui-lib-1.2.0.tgz"
}
```

和 `npm link` 相比，這個做法更接近真實情況。`npm link` 使用 symlink，會直接讀取原始專案資料夾，可能導致兩個問題。第一，套件裡沒被發佈的檔案也能被讀到，掩蓋了 `files` 設定的錯誤。第二，元件庫自己的 `node_modules` 裡可能有另一份 Vue，造成「多個 Vue 實例」的錯誤，例如 `inject()` 失效、響應式異常。用 tarball 安裝就和使用者從 npm 安裝的結果一模一樣。

如果要檢查 tarball 內容，可以直接解壓或列出內容。注意所有檔案都會放在 `package/` 資料夾底下：

```bash
tar -tzf my-ui-lib-1.2.0.tgz
# package/package.json
# package/dist/index.mjs
# ...
```

### 其他用途

`npm pack` 也常用在 CI/CD：在 CI 中建置並打包，把 `.tgz` 存成 artifact，之後的部署或發佈步驟直接使用同一個檔案，確保測試過的和發佈出去的是同一份。另外，在不能使用公開 registry 或需要離線安裝的環境中，也可以直接傳遞 `.tgz` 檔案，用 `npm install ./xxx.tgz` 安裝。

### 常見陷阱

**修改後重新打包但版本號沒變**：如果用相同版本號重新打包，再重新安裝時，可能因為 lock 檔中的 `integrity` 雜湊值不符而出錯，或是使用到快取的舊版本。這時可以刪掉 `node_modules` 中的該套件再重新安裝，或在測試時暫時改用 `1.2.0-test.1` 這類預發佈版本號。

**`.tgz` 不小心被 commit 或被打包進下一版**：建議把 `*.tgz` 加入 `.gitignore`。如果使用 `files` 白名單，就不會有被打包進去的問題。

**`exports` 欄位指向不存在的檔案**：`npm pack` 不會檢查 `exports` 路徑是否正確。建議實際安裝 tarball 測試，或搭配 `publint`、`@arethetypeswrong/cli` 等工具檢查。

### 和其他套件管理工具的比較

`yarn pack` 和 `pnpm pack` 的功能大致相同。在 monorepo 中有一點值得注意：`pnpm pack` 會自動把 `workspace:*` 這類協定替換成實際版本號，而 `npm pack` 不支援 `workspace:` 協定。

---

## 2. package.json 的 `engines` 欄位

### 基本概念

`engines` 用來宣告這個專案或套件**需要哪個版本的執行環境**才能正常運作。最常見的是指定 Node.js 版本，也可以指定 npm 等套件管理工具的版本。

```json
{
  "engines": {
    "node": ">=20.0.0",
    "npm": ">=10.0.0"
  }
}
```

這段的意思是：「此專案需要 Node.js 20 以上、npm 10 以上。」

### 版本範圍語法

`engines` 的值使用 semver 範圍語法，和 `dependencies` 裡的寫法相同：

```jsonc
"node": ">=20.0.0"              // 20.0.0 以上（含）
"node": "^20.11.0"              // >=20.11.0 且 <21.0.0
"node": "20.x"                  // 任何 20 版
"node": ">=20.11.0 <23"         // 介於兩者之間
"node": "^20.11.0 || >=22.0.0"  // 20.11 以上的 20 版，或 22 以上
```

`||` 的寫法很實用。Node.js 的奇數版本（21、23）不是 LTS，生命週期很短，很多專案只想支援偶數的 LTS 版本，就會用這種方式表達。

### 重點：預設只是「建議」，不會強制

這是最容易誤解的地方。**npm 預設不會因為 `engines` 不符就阻止安裝**，行為分成兩種情況。

**你安裝的相依套件的 `engines` 不符**：npm 只會顯示警告，安裝照常進行：

```
npm warn EBADENGINE Unsupported engine {
npm warn EBADENGINE   package: 'some-lib@2.0.0',
npm warn EBADENGINE   required: { node: '>=22' },
npm warn EBADENGINE   current: { node: 'v20.11.0', npm: '10.2.4' }
npm warn EBADENGINE }
```

**你自己專案的 `engines` 不符**：預設下也不會擋住 `npm install`。

#### 讓 npm 強制檢查：`engine-strict`

如果希望版本不符時直接報錯，可以在專案根目錄的 `.npmrc` 加上：

```ini
engine-strict=true
```

這樣當開發者的 Node.js 版本不符合專案的 `engines` 時，`npm install` 和 `npm ci` 會直接失敗，而不只是警告。把 `.npmrc` 一起 commit，團隊所有人和 CI 就都會套用這個規則。

舊版 npm 曾支援在 package.json 裡寫 `"engineStrict": true`，但這個欄位早已移除，現在必須用 `.npmrc` 設定。

### 不同套件管理工具的行為

| 工具 | 預設行為 |
|---|---|
| npm | 只警告；設定 `engine-strict=true` 才會報錯 |
| Yarn 1（classic） | 預設就嚴格檢查，不符會報錯；可用 `--ignore-engines` 略過 |
| Yarn 2+（Berry） | 不檢查 `engines` |
| pnpm | 預設警告；設定 `engine-strict=true` 會報錯 |

如果團隊混用不同工具，同一份 `engines` 可能在某人電腦上報錯、在另一人電腦上沒反應，所以最好統一套件管理工具。

### 兩種使用情境

#### 應用程式專案（例如 Nuxt 網站）

目的是**確保團隊和部署環境一致**，可以寫得比較嚴格：

```json
{
  "engines": {
    "node": "^20.11.0 || >=22.0.0"
  }
}
```

搭配 `.npmrc`：

```ini
engine-strict=true
```

再加上 `.nvmrc`（給 nvm、fnm 等版本管理工具自動切換用）：

```
22
```

`engines` 負責**檢查**，`.nvmrc` 負責**切換**，兩者分工不同，通常會一起使用。

#### 函式庫／套件（會發佈到 npm）

目的是**告訴使用者最低需求**，應該盡量寬鬆，只寫真正的下限：

```json
{
  "engines": {
    "node": ">=18"
  }
}
```

不要隨意設定上限（例如 `<21`）。否則 Node 新版本一出來，使用者就會看到一堆警告，用 Yarn 1 的人甚至會安裝失敗，但你的套件其實可能完全相容。只有在確定用了某版本才有的 API（例如 `fetch`、`structuredClone`）時，才提高下限。

### 在 CI 中使用

GitHub Actions 的 `actions/setup-node` 支援用 `node-version-file` 讀取版本設定，可以指向 `.nvmrc`，在較新版本中也能讀取 `package.json` 的 `engines.node`，讓 CI 和專案宣告的版本保持一致：

```yaml
- uses: actions/setup-node@v4
  with:
    node-version-file: '.nvmrc'
```

各版本支援的檔案類型可能不同，建議查一下你所用版本的文件。

### 相關欄位

**`packageManager`**：指定專案使用的套件管理工具和確切版本，例如 `"packageManager": "pnpm@9.12.0"`。搭配 Node.js 內建的 Corepack，可以自動使用正確的 pnpm 或 Yarn 版本。它和 `engines` 不同，是「指定要用哪一個」，而不只是「檢查版本範圍」。

**`devEngines`**：較新的 npm 版本（10.9 起）加入的欄位，專門描述**開發這個專案**時需要的環境，可以設定不符時是報錯還是警告。和 `engines` 的差別在於，它只影響在這個專案裡開發的人，不會影響安裝你套件的使用者。這個欄位還很新，各工具支援度不一，採用前建議先確認團隊的 npm 版本。

**`os`、`cpu`**：限制套件只能安裝在特定作業系統或 CPU 架構上，例如 `"os": ["darwin", "linux"]`。這兩個欄位**會被強制執行**，常見於包含原生二進位檔的套件，例如 esbuild 各平台的子套件。

### 小結

`engines` 本身只是宣告，真正要發揮作用，通常需要搭配以下設定：

```
package.json   → "engines": { "node": "..." }    宣告需求
.npmrc         → engine-strict=true             強制檢查
.nvmrc         → 22                             自動切換版本
CI 設定         → node-version-file             讓 CI 使用相同版本
```

---

## 3. package.json 的 `main` 與 `exports`

這兩個欄位都用來回答同一個問題：**當別人寫 `import x from 'your-pkg'` 時，實際載入的是哪個檔案？** `main` 是傳統做法，`exports` 是 Node.js 12 之後加入的新機制，功能強大得多。

### 3.1 `main`：傳統的單一入口

```json
{
  "name": "my-lib",
  "main": "./dist/index.js"
}
```

當使用者 `require('my-lib')` 或 `import 'my-lib'` 時，就會載入 `node_modules/my-lib/dist/index.js`。

`main` 有幾個特性。沒寫的話，預設是 `index.js`。它只能指定**一個**入口，無法依環境（ESM、CommonJS、瀏覽器）提供不同檔案。而且它**不會限制存取**：使用者仍然可以直接 import 套件裡的任何檔案，例如 `import x from 'my-lib/dist/internal/helper.js'`。這代表內部檔案結構實際上變成了公開 API，日後只要調整資料夾結構，就可能破壞使用者的程式碼。

檔案會被當成 ESM 還是 CommonJS 解析，取決於副檔名和 `type` 欄位。`.mjs` 一定是 ESM，`.cjs` 一定是 CommonJS，`.js` 則看 package.json 的 `"type"`：設為 `"module"` 時是 ESM，沒設或設為 `"commonjs"` 時是 CommonJS。

### 3.2 `main` 時代的非標準欄位

因為 `main` 只能有一個入口，社群發展出幾個額外欄位，至今仍很常見：

**`module`**：指向 ESM 版本，例如 `"module": "./dist/index.mjs"`。它**不是 Node.js 的標準**，Node 完全忽略這個欄位，只有 webpack、Rollup、Vite 等打包工具會讀取，用來做 tree-shaking。

**`browser`**：指向瀏覽器專用版本，同樣只有打包工具會讀取。

**`types`**（或 `typings`）：指向 TypeScript 型別定義檔，供 TypeScript 讀取。

### 3.3 `exports`：現代的入口定義

`exports` 解決了 `main` 的所有限制，主要提供三種能力：**多個入口**、**依條件提供不同檔案**、**封裝內部檔案**。

最重要的規則是：**只要定義了 `exports`，Node.js 和現代打包工具就會優先使用它，完全忽略 `main`**。

#### 1. 最簡寫法

```json
{
  "exports": "./dist/index.js"
}
```

等同於：

```json
{
  "exports": {
    ".": "./dist/index.js"
  }
}
```

`"."` 代表套件根入口，也就是 `import 'my-lib'`。所有路徑都**必須以 `./` 開頭**。

#### 2. 封裝（Encapsulation）

這是 `exports` 和 `main` 最大的行為差異：**沒有列在 `exports` 中的路徑，外部一律無法 import**。

```json
{
  "exports": {
    ".": "./dist/index.js"
  }
}
```

```js
import lib from 'my-lib'                        // ✅ 可以
import helper from 'my-lib/dist/helper.js'      // ❌ 錯誤
// Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: Package subpath './dist/helper.js'
// is not defined by "exports" in .../my-lib/package.json
```

好處是你可以自由調整內部結構，只要 `exports` 對外的路徑不變，就不會破壞使用者。

但也要注意：**為既有套件加上 `exports` 是破壞性變更（breaking change）**。原本使用者能 import 的深層路徑會突然失效，所以應該在 major 版本中加入。

#### 3. 子路徑匯出（Subpath exports）

提供多個公開入口：

```json
{
  "exports": {
    ".": "./dist/index.js",
    "./utils": "./dist/utils/index.js",
    "./style.css": "./dist/style.css",
    "./package.json": "./package.json"
  }
}
```

```js
import { Button } from 'my-lib'
import { formatDate } from 'my-lib/utils'
import 'my-lib/style.css'
```

注意，對外的路徑（`./utils`）和實際檔案路徑（`./dist/utils/index.js`）可以完全不同，等於幫使用者隱藏了 `dist/` 這層結構。

建議也匯出 `./package.json`。有些工具需要讀取套件的 package.json（例如取得版本號），沒有匯出的話會因為封裝規則而讀不到。

#### 4. 子路徑模式（Subpath patterns）

用 `*` 一次匯出一整批檔案，很適合元件庫：

```json
{
  "exports": {
    ".": "./dist/index.js",
    "./components/*": "./dist/components/*.js",
    "./components/internal/*": null
  }
}
```

```js
import Button from 'my-lib/components/Button'
// → ./dist/components/Button.js

import X from 'my-lib/components/internal/Foo'
// → ❌ 設為 null 代表明確禁止存取
```

`*` 會做單純的字串替換，並且可以包含 `/`，所以 `my-lib/components/forms/Input` 會對應到 `./dist/components/forms/Input.js`。

#### 5. 條件匯出（Conditional exports）

依照載入方式或執行環境提供不同檔案，這是 `exports` 最強大的功能：

```json
{
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs"
    }
  }
}
```

用 `import` 載入時取得 ESM 版本，用 `require()` 載入時取得 CommonJS 版本。

常見的條件名稱如下：

| 條件 | 意義 | 支援者 |
|---|---|---|
| `types` | TypeScript 型別定義 | TypeScript |
| `import` | 透過 `import` / `import()` 載入 | Node.js、打包工具 |
| `require` | 透過 `require()` 載入 | Node.js、打包工具 |
| `node` | 在 Node.js 環境中 | Node.js、打包工具 |
| `browser` | 在瀏覽器環境中 | 打包工具 |
| `development` / `production` | 開發／正式模式 | Vite、webpack 等（社群慣例） |
| `default` | 以上都不符合時的後備選項 | 全部 |

#### 6. 條件的順序非常重要

解析時會**由上到下比對，採用第一個符合的條件**。這是 JSON 中少數「鍵的順序有意義」的情況，因此要遵守兩條規則：**`types` 放最前面**，**`default` 放最後面**。

```jsonc
// ✅ 正確
{
  ".": {
    "types": "./dist/index.d.ts",
    "import": "./dist/index.mjs",
    "require": "./dist/index.cjs",
    "default": "./dist/index.mjs"
  }
}

// ❌ 錯誤：default 在最前面，後面的條件永遠不會被比對到
{
  ".": {
    "default": "./dist/index.mjs",
    "import": "./dist/index.mjs",
    "types": "./dist/index.d.ts"
  }
}
```

#### 7. 巢狀條件

條件可以巢狀組合。最常見的用途是讓 ESM 和 CommonJS 各自擁有對應的型別定義檔：

```json
{
  "exports": {
    ".": {
      "import": {
        "types": "./dist/index.d.ts",
        "default": "./dist/index.js"
      },
      "require": {
        "types": "./dist/index.d.cts",
        "default": "./dist/index.cjs"
      }
    }
  }
}
```

為什麼要分開？TypeScript 會依照型別檔的副檔名（`.d.ts` 配合 `"type": "module"`、`.d.cts`、`.d.mts`）判斷對應的 JS 檔是 ESM 還是 CJS。如果 ESM 和 CJS 共用同一份 `.d.ts`，TypeScript 可能會誤判模組格式，導致型別看起來正確、執行時卻出錯。這個問題通常稱為「Masquerading as ESM／CJS」。

### 3.4 TypeScript 與 `exports`

TypeScript 會不會讀取 `exports`，取決於使用者 tsconfig 中的 `moduleResolution`：

| `moduleResolution` | 讀取 `exports`？ |
|---|---|
| `node` / `node10`（舊預設） | ❌ 不讀，只看 `types` 和 `main` |
| `node16` / `nodenext` | ✅ 讀取 |
| `bundler` | ✅ 讀取（Vite、Nuxt 專案常用） |

因此，為了相容使用舊設定的使用者，發佈套件時建議**同時保留頂層的 `types`**。如果子路徑也需要支援舊設定，可以使用 `typesVersions` 欄位，不過隨著舊設定逐漸淘汰，這種需求已經越來越少。

### 3.5 解析優先順序整理

```
Node.js：
  有 exports？ → 使用 exports（忽略 main）
  沒有？       → 使用 main → 沒有 main 則找 index.js

打包工具（Vite / webpack / Rollup）：
  有 exports？ → 使用 exports，依工具設定的條件比對
  沒有？       → browser → module → main（各工具順序略有差異）

TypeScript：
  moduleResolution 為 bundler / node16 / nodenext 且有 exports？
               → 使用 exports 中的 types 條件
  否則         → types / typings → 與 main 同名的 .d.ts
```

### 3.6 完整範例：Vue 元件庫

以下是一個同時支援 ESM、CommonJS、TypeScript 和 CSS，並兼顧舊工具的設定：

```json
{
  "name": "@win/ui",
  "version": "1.0.0",
  "type": "module",

  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",

  "exports": {
    ".": {
      "import": {
        "types": "./dist/index.d.ts",
        "default": "./dist/index.js"
      },
      "require": {
        "types": "./dist/index.d.cts",
        "default": "./dist/index.cjs"
      }
    },
    "./components/*": {
      "types": "./dist/components/*.d.ts",
      "default": "./dist/components/*.js"
    },
    "./style.css": "./dist/style.css",
    "./package.json": "./package.json"
  },

  "files": ["dist"],
  "sideEffects": ["**/*.css"],

  "peerDependencies": {
    "vue": "^3.4.0"
  }
}
```

逐一說明幾個重點：

**`type: "module"`**：讓 `dist/` 中的 `.js` 被當成 ESM，所以 CommonJS 版本必須使用 `.cjs` 副檔名。

**`main`、`module`、`types` 保留在頂層**：給不支援 `exports` 的舊工具使用。現代工具會忽略它們，所以不會衝突。

**`./style.css`**：Vite library mode 通常會把元件樣式輸出成單獨的 CSS 檔，必須明確匯出，否則使用者 `import '@win/ui/style.css'` 會被封裝規則擋下。

**`sideEffects`**：這個欄位不屬於 `exports`，但和它密切相關。它告訴打包工具除了 CSS 以外的檔案都沒有副作用，可以放心 tree-shake。如果設成 `false` 卻沒有排除 CSS，引入的樣式可能會被打包工具整個移除。

**`peerDependencies` 中的 `vue`**：讓元件庫使用宿主專案的 Vue，避免出現多個 Vue 實例。

### 3.7 雙重套件危害（Dual package hazard）

同時提供 ESM 和 CJS 版本時，有一個需要知道的風險：如果同一個應用程式中，某處用 `import`、另一處用 `require()` 載入你的套件，就會**載入兩份不同的模組實例**。

如果套件有模組層級的狀態（例如全域設定、單例 store、`provide`/`inject` 用的 Symbol key），兩份實例的狀態不會共享，可能導致難以追查的錯誤，像是設定了 A 卻在 B 讀不到，或 `instanceof` 判斷失敗。

常見的處理方式有兩種：把狀態集中放在其中一個格式中，讓另一個格式包裝它；或者乾脆只發佈 ESM。對於主要給 Vite、Nuxt 專案使用的前端套件，**只發佈 ESM** 是越來越常見、也最單純的選擇。

### 3.8 相關欄位：`imports`

`imports` 和 `exports` 是一對的。`exports` 定義**外部**怎麼使用你的套件，`imports` 則定義套件**內部**的路徑別名，鍵名必須以 `#` 開頭：

```json
{
  "imports": {
    "#utils/*": "./src/utils/*.js",
    "#config": {
      "node": "./src/config.node.js",
      "default": "./src/config.browser.js"
    }
  }
}
```

```js
// 在套件內部任何地方
import { format } from '#utils/date'
import config from '#config'
```

它的作用類似 tsconfig 的 `paths` 或 Vite 的 `alias`，但這是 Node.js 原生支援的標準，不需要額外設定打包工具。

### 3.9 驗證工具

`exports` 很容易寫錯，而且錯誤通常要等到使用者安裝後才會發現。發佈前建議用以下工具檢查：

```bash
# 檢查 package.json 的 exports、main、types 等設定是否正確
npx publint

# 檢查各種 moduleResolution 設定下，型別解析是否正確
npx @arethetypeswrong/cli --pack .
```

再搭配第 1 章提到的 `npm pack`，把 tarball 安裝到實際專案中測試，就能涵蓋大部分問題。