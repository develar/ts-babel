#! /usr/bin/env node

const gulp = require("gulp")
const babel = require("gulp-babel")
const ts = require('gulp-typescript')
const parallel = require("run-parallel")
const fs = require("fs")
const path = require("path")
const sourcemaps = require("gulp-sourcemaps")
const changed = require("gulp-changed")

function readFile(file, pathToData, callback) {
  fs.readFile(file, "utf8", function readFileCallback(error, result) {
    if (error == null) {
      pathToData[path.basename(file, ".json")] = JSON.parse(result)
      callback(null)
    }
    else {
      callback(error)
    }
  })
}

const pathToData = Object.create(null)
parallel([readFile.bind(null, "tsconfig.json", pathToData), readFile.bind(null, "package.json", pathToData)], function (error) {
  if (error != null) {
    console.error(error)
    process.exit(1)
  }

  compile()
})

function compile() {
  const tsConfig = pathToData.tsconfig
  const filesGlob = tsConfig.filesGlob
  if (filesGlob == null) {
    throw new Error("filesGlob is not specified in the tsconfig.json")
  }

  const compilerOptions = tsConfig.compilerOptions
  const destination = tsConfig.compilerOptions.outDir
  if (destination == null) {
    throw new Error("outDir is not specified in the tsconfig.json compilerOptions")
  }

  delete compilerOptions.outDir
  delete compilerOptions.inlineSources
  delete compilerOptions.sourceMap
  compilerOptions.noExternalResolve = true

  if (pathToData.package.devDependencies.typescript != null) {
    compilerOptions.typescript = require(path.join(process.cwd(), "node_modules", "typescript"))
  }

  const tsProject = ts.createProject(compilerOptions)
  const tsResult = gulp.src(filesGlob)
    .pipe(sourcemaps.init())
    .pipe(ts(tsProject))

  tsResult.js
    .pipe(changed(destination, {extension: ".js"}))
    .pipe(babel())
    .pipe(sourcemaps.write())
    .pipe(gulp.dest(destination))
}