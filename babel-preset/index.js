const {declare} = require("@babel/helper-plugin-utils")

module.exports = declare(function (api) {
  api.assertVersion(7)

  return {
    plugins: [
      [
        "transform-async-to-module-method",
        {
          module: "bluebird-lst",
          method: "coroutine"
        }
      ],
      [
        "@babel/plugin-transform-modules-commonjs",
        {
          lazy: string => !(string === "debug" || string === "path")
        }
      ],
    ]
  }
})