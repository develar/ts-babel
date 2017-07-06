#! /usr/bin/env node

import * as ts from "typescript"
import * as path from "path"
import * as babel from "babel-core"
import { readdir, ensureDir, unlink, outputFile, outputJson, readJson } from "fs-extra-p"
import BluebirdPromise from "bluebird-lst"
import { generateDeclarationFile } from "./declarationGenerator"
import { transpile, checkErrors } from "./util"

//noinspection JSUnusedLocalSymbols
const __awaiter = require("./awaiter")

transpile(async (basePath: string, config: ts.ParsedCommandLine, tsConfig: any) => {
  console.log(`Building ${basePath}`)

  const compilerOptions = config.options
  let declarationConfig: any = tsConfig.declaration
  if (declarationConfig === false) {
    declarationConfig = null
  }

  if (declarationConfig != null) {
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

  const target = compilerOptions.target || ts.ScriptTarget.Latest
  const fileToSourceMap: any = {}
  const promises: Array<Promise<any>> = []
  const emittedFiles = new Set<string>()
  const declarationFiles = Array<ts.SourceFile>()
  const emitResult = program.emit(undefined, (fileName, data) => {
    emittedFiles.add(fileName)

    if (fileName.endsWith(".js")) {
      const sourceMapFileName = `${fileName}.map`
      processCompiled(data, fileToSourceMap[sourceMapFileName], fileName, sourceMapFileName, promises)
    }
    else if (fileName.endsWith(".js.map")) {
      fileToSourceMap[fileName] = data
    }
    else if (declarationConfig != null) {
      declarationFiles.push(ts.createSourceFile(fileName, data, target, true))
    }
  })

  checkErrors(emitResult.diagnostics)
  if (emitResult.emitSkipped) {
    throw new Error("Emit skipped")
  }

  if (declarationFiles.length > 0) {
    let packageData = null
    try {
      packageData = await readJson(path.join(basePath, "package.json"))
    }
    catch (e) {
    }

    const main = packageData == null ? null : packageData.main
    if (typeof declarationConfig === "string") {
      declarationConfig = {
        [packageData.name]: declarationConfig,
      }
    }
    else if (declarationConfig === true) {
      declarationConfig = {
        [packageData.name]: path.join(path.resolve(compilerOutDir), `${packageData.name}.d.ts`),
      }
    }

    for (const moduleName of Object.keys(declarationConfig)) {
      promises.push(generateDeclarationFile(moduleName, declarationFiles, compilerOptions, path.resolve(basePath, declarationConfig[moduleName]), basePath, main))
    }
  }
  
  await BluebirdPromise.all(promises)
  await removeOld(compilerOutDir, emittedFiles)
})
  .catch(error => {
    console.error(error.stack || error.message || error)
    process.exit(-1)
  })

async function removeOld(outDir: string, emittedFiles: Set<string>): Promise<any> {
  const files = await readdir(outDir)
  await BluebirdPromise.map(files, file => {
    if (file.endsWith(".js") || file.endsWith(".js.map")) {
      // ts uses / regardless of OS
      const fullPath = `${outDir}/${file}`

      if (!file.includes(".")) {
        return removeOld(fullPath, emittedFiles)
      }
      else if (!emittedFiles.has(fullPath)) {
        return unlink(fullPath)
      }
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

  promises.push(
    outputFile(jsFileName, result.code),
    outputJson(sourceMapFileName, result.map))
}