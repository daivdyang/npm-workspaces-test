import { test } from '@app/core'

// @app/core package.json的exports要配置路徑，這裡才能加載，否則會報錯
import { m1 } from '@app/core/lib1'

console.log('[start] app1/index.js')
test()
m1()
console.log('[end] app1/index.js')