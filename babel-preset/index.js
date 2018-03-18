const {declare} = require("@babel/helper-plugin-utils")

module.exports = declare(function (api) {
  api.assertVersion(7)

  const plugins = [
    [
      "@babel/plugin-transform-modules-commonjs",
      {
        lazy: string => !(string === "debug" || string === "path")
      }
    ],

  ]

  if (process.env.NODE_ENV === "production" || process.env.BABEL_ENV === "production") {
    plugins[1] = [
      "transform-async-to-module-method",
      {
        module: "bluebird-lst",
        method: "coroutine"
      }
    ]
  }

  return {plugins: plugins}
})