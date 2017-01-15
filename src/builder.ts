#! /usr/bin/env node

import * as ts from "typescript"
import * as path from "path"
import * as babel from "babel-core"
import { readdir, ensureDir, unlink, outputFile, readFile, outputJson, readJson } from "fs-extra-p"
import BluebirdPromise from "bluebird-lst-c"
import { generateDeclarationFile } from "./declarationGenerator"
import { generateDocs, writeDocFile, renderDocs } from "./docGenerator"

//noinspection JSUnusedLocalSymbols
const __awaiter = require("./awaiter")

async function main() {
  const paths = process.argv.slice(2)
  if (paths.length == 0) {
    paths.push(process.cwd())
  }

  for (let basePath of paths) {
    try {
      console.log(`Build ${basePath}`)
      await build(basePath)
    }
    catch (e) {
      if (!(e instanceof CompilationError)) {
        throw e
      }

      for (let diagnostic of e.errors) {
        if (diagnostic.file == null) {
          console.log(diagnostic.messageText)
          continue
        }

        const location = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
        const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
        console.log(`${diagnostic.file.fileName} (${location.line + 1}, ${location.character + 1}): ${message}`)
      }
      process.exit(-1)
      return
    }
  }
}

main()
  .catch(error => {
    console.error(error.stack || error.message || error)
    process.exit(-1)
  })

async function build(basePath: string) {
  const tsConfigPath = path.join(basePath, "tsconfig.json")
  const jsonResult = ts.parseConfigFileTextToJson(tsConfigPath, await readFile(tsConfigPath, "utf8"))
  if (jsonResult.error != null) {
    throw new CompilationError([jsonResult.error])
  }

  const result = ts.parseJsonConfigFileContent(jsonResult.config, ts.sys, basePath)
  checkErrors(result.errors)

  await compile(basePath, result, jsonResult.config)
}

async function compile(basePath: string, config: ts.ParsedCommandLine, tsConfig: any) {
  const compilerOptions = config.options
  const declarationConfig: any = tsConfig.declaration

  if (declarationConfig != null) {
    compilerOptions.declaration = true
  }

  compilerOptions.noEmitOnError = true

  const program = ts.createProgram(config.fileNames, compilerOptions, ts.createCompilerHost(compilerOptions))
  checkErrors(ts.getPreEmitDiagnostics(program))

  const outDir = compilerOptions.outDir
  if (outDir == null) {
    throw new Error("outDir is not specified in the compilerOptions")
  }

  await ensureDir(outDir)

  const target = compilerOptions.target || ts.ScriptTarget.Latest
  const fileToSourceMap: any = {}
  const promises: Array<Promise<any>> = []
  const emittedFiles = new Set<string>()
  const declarationFiles = Array<ts.SourceFile>()
  const emitResult = program.emit(undefined, (fileName, data) => {
    emittedFiles.add(fileName)

    if (fileName.endsWith(".js")) {
      const sourceMapFileName = fileName + ".map"
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
    for (const moduleName of Object.keys(declarationConfig)) {
      promises.push(generateDeclarationFile(moduleName, declarationFiles, compilerOptions, path.join(basePath, declarationConfig[moduleName]), basePath, main))
    }
  }

  if (process.env.CI == null && tsConfig.docs != null) {
    const parsedDocs = generateDocs(program)
    const docs = renderDocs(parsedDocs)
    if (docs.length !== 0) {
      promises.push(writeDocFile(path.resolve(basePath, tsConfig.docs), docs))
    }

    // const jsStubs = writeToJs(program)
    // if (jsStubs.length !== 0) {
    //   promises.push(writeDocFile(path.resolve(basePath, "js-stubs.js"), jsStubs))
    // }
  }

  await BluebirdPromise.all(promises)
  await removeOld(outDir, emittedFiles)
}

async function removeOld(outDir: string, emittedFiles: Set<string>): Promise<any> {
  const files = await readdir(outDir)
  await BluebirdPromise.map(files, file => {
    if (file[0] !== "." && !file.endsWith(".d.ts") && file !== "__snapshots__") {
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
    inputSourceMap: JSON.parse(sourceMap),
    sourceMaps: true,
    filename: jsFileName,
  })

  promises.push(
    outputFile(jsFileName, result.code),
    outputJson(sourceMapFileName, result.map))
}

function checkErrors(errors: Array<ts.Diagnostic>): void {
  if (errors.length !== 0) {
    throw new CompilationError(errors)
  }
}

class CompilationError extends Error {
  constructor(public errors: Array<ts.Diagnostic>) {
    super("Compilation error")
  }
}