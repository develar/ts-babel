#! /usr/bin/env node

require("v8-compile-cache")

import * as ts from "typescript"
import * as babel from "@babel/core"
import { readdir, ensureDir, unlink, outputFile, outputJson } from "fs-extra-p"
import BluebirdPromise from "bluebird-lst"
import { transpile, checkErrors } from "./util"

transpile(async (basePath: string, config: ts.ParsedCommandLine, tsConfig: any) => {
  const compilerOptions = config.options
  if (tsConfig.declaration !== false) {
    compilerOptions.declaration = true
  }

  compilerOptions.noEmitOnError = true

  const program = ts.createProgram(config.fileNames, compilerOptions, ts.createCompilerHost(compilerOptions))
  checkErrors(ts.getPreEmitDiagnostics(program))

  const compilerOutDir = compilerOptions.outDir
  if (compilerOutDir == null) {
    throw new Error("outDir is not specified in the compilerOptions")
  }

  await ensureDir(compilerOutDir)

  const fileToSourceMap: any = {}
  const promises: Array<Promise<any>> = []
  const emittedFiles = new Set<string>()
  const emitResult = program.emit(undefined, (fileName: string, data: any) => {
    emittedFiles.add(fileName)

    if (fileName.endsWith(".js")) {
      const sourceMapFileName = `${fileName}.map`
      processCompiled(data, fileToSourceMap[sourceMapFileName], fileName, sourceMapFileName, promises)
    }
    else if (fileName.endsWith(".js.map")) {
      fileToSourceMap[fileName] = data
    }
    else {
      promises.push(outputFile(fileName, data))
    }
  })

  checkErrors(emitResult.diagnostics)
  if (emitResult.emitSkipped) {
    throw new Error("Emit skipped")
  }

  await BluebirdPromise.all(promises)
  await removeOld(compilerOutDir, emittedFiles)
})
  .catch(error => {
    console.error(error.stack || error.message || error)
    process.exit(-1)
  })

async function removeOld(outDir: string, emittedFiles: Set<string>): Promise<any> {
  await BluebirdPromise.map(await readdir(outDir), file => {
    // ts uses / regardless of OS
    const fullPath = `${outDir}/${file}`
    if (!file.includes(".")) {
      return removeOld(fullPath, emittedFiles)
    }

    if ((file.endsWith(".js") || file.endsWith(".js.map") || file.endsWith(".d.ts")) && !emittedFiles.has(fullPath)) {
      return unlink(fullPath)
    }
    return null
  })
}

function processCompiled(code: string, sourceMap: string, jsFileName: string, sourceMapFileName: string, promises: Array<Promise<any>>) {
  const result = babel.transform(code, {
    inputSourceMap: sourceMap == null ? null : JSON.parse(sourceMap),
    sourceMaps: true,
    filename: jsFileName,
  })

  const match = code.match(regex)!
  const sourceMapUrl = match[1] || match[2]

  promises.push(
    outputFile(jsFileName, result.code.replace(regex, "") + `\n//# sourceMappingURL=${sourceMapUrl}`),
    outputJson(sourceMapFileName, result.map))
}

const innerRegex = /[#@] sourceMappingURL=([^\s'"]*)/
const regex = RegExp(
  "(?:" +
  "/\\*" +
  "(?:\\s*\r?\n(?://)?)?" +
  "(?:" + innerRegex.source + ")" +
  "\\s*" +
  "\\*/" +
  "|" +
  "//(?:" + innerRegex.source + ")" +
  ")" +
  "\\s*"
)