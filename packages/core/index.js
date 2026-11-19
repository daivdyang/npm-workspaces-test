
import { m1 } from '#utils/index'

console.log('run core.js')
/**
 * this is core test function
 */
function test() {
    console.log('execute core.test function')
}

/**
 * this is core runM1 function
 */
function runM1() {
    console.log('run "m1"method from ./lib1/index.js')
    m1()
}

export { test, runM1 }