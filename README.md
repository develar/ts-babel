TypeScript allows you only to set target. If you target to es6, no way to compile `rest parameters` to ES5.
But you have to do it because Node support ES6 features step by step and some features [are behind flags](https://nodejs.org/en/docs/es6/).

So, [Babel](http://babeljs.io) is used to transform code.

Run `ts-babel` to compile. Compiler options are taken automatically from your `tsconfig.json`.
Specify [babel configuration](https://babeljs.io/docs/usage/babelrc/) in the `package.json`.

## Related

* [Generate JSDoc from Typescript](https://github.com/develar/ts2jsdoc)