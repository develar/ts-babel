module.exports = {
  plugins: [
    [
      "transform-async-to-module-method",
      {
        module: "bluebird-lst",
        method: "coroutine"
      }
    ],
    "transform-es2015-parameters",
    "transform-es2015-spread",
    "transform-es2015-destructuring",
    "array-includes",
    [
      "transform-inline-imports-commonjs",
      {
        excludeModules: ["path"]
      }
    ],
  ]
}