#! /usr/bin/env node

"use strict"

const gulp = require("gulp")
const babel = require("gulp-babel")
const ts = require('gulp-typescript')
const parallel = require("run-parallel")
const fs = require("fs")
const path = require("path")
const sourcemaps = require("gulp-sourcemaps")
const vinylPaths = require("vinyl-paths")

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
  const destination = path.resolve(tsConfig.compilerOptions.outDir)
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

  const pathCollector = vinylPaths()
  tsResult.js
    .pipe(babel())
    .pipe(sourcemaps.write("."))
    .pipe(pathCollector)
    .pipe(gulp.dest(destination))
    .on("end", function () {
      fs.readdir(destination, function (error, files) {
        if (error != null) {
          console.error(error)
          return
        }

        const existing = new Set(pathCollector.paths.map(it => path.basename(it)))
        for (let file of files) {
          if (file[0] !== "." && !existing.has(file)) {
            fs.unlink(path.join(destination, file), error => {
              if (error != null) console.error(error)
            })
          }
        }
      })
    })
}