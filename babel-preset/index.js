module.exports = {
  plugins: [
    [
      "transform-async-to-module-method",
      {
        module: "bluebird-lst",
        method: "coroutine"
      }
    ],
    [
      "transform-inline-imports-commonjs",
      {
        excludeModules: ["path", "debug"]
      }
    ],
  ]
}