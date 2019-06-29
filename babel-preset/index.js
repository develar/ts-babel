const {declare} = require("@babel/helper-plugin-utils")

module.exports = declare(function (api) {
  api.assertVersion(7)

  const plugins = [
    [
      "@babel/plugin-transform-modules-commonjs",
      {
        lazy: string => !(string === "debug" || string === "path" || string === "fs")
      }
    ],
  ]

  return {plugins: plugins}
})