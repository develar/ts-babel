import * as ts from "typescript"
import * as path from "path"
import * as babel from "babel-core"
import { readdir, ensureDir, unlink, outputFile, readFile, outputJson } from "fs-extra-p"
import { Promise as BluebirdPromise } from "bluebird"
import { generateDeclarationFile } from "./declarationGenerator"
import { generateDocs, writeDocFile } from "./docGenerator"

//noinspection JSUnusedLocalSymbols
const __awaiter = require("./awaiter")

const basePath = process.argv.length === 3 ?  path.resolve(process.argv[2]) : process.cwd()
const tsConfigPath = path.join(basePath, "tsconfig.json")

main()
  .catch(error => {
    if (error instanceof CompilationError) {
      for (let diagnostic of error.errors) {
        if (diagnostic.file == null) {
          console.log(diagnostic.messageText)
          continue
        }

        const location = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
        const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
        console.log(`${diagnostic.file.fileName} (${location.line + 1},${location.character + 1}): ${message}`)
      }
    }
    else {
      console.error(error.stack || error.message || error)
    }
    process.exit(-1)
  })

async function main() {
  const jsonResult = ts.parseConfigFileTextToJson(tsConfigPath, await readFile(tsConfigPath, "utf8"))
  if (jsonResult.error != null) {
    throw new CompilationError([jsonResult.error])
  }

  const result = ts.parseJsonConfigFileContent(jsonResult.config, {
    readDirectory: ts.sys.readDirectory
  }, basePath)
  checkErrors(result.errors)

  await compile(result, jsonResult.config)
}

async function compile(config: ts.ParsedCommandLine, tsConfig: any) {
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

  if (process.env.CI == null && tsConfig.docs != null) {
    const docs = generateDocs(program)
    if (docs.length !== 0) {
      writeDocFile(path.resolve(basePath, tsConfig.docs), docs)
    }
  }

  checkErrors(emitResult.diagnostics)
  if (emitResult.emitSkipped) {
    throw new Error("Emit skipped")
  }

  if (declarationFiles.length > 0) {
    for (let moduleName of Object.keys(declarationConfig)) {
      promises.push(generateDeclarationFile(moduleName, declarationFiles, compilerOptions, path.join(basePath, declarationConfig[moduleName]), basePath))
    }
  }

  await BluebirdPromise.all(promises)

  promises.length = 0
  await removedOld(outDir, emittedFiles, promises)
  await BluebirdPromise.all(promises)
}

async function removedOld(outDir: string, emittedFiles: Set<string>, promises: Array<Promise<any>>) {
  const files = await readdir(outDir)
  for (let file of files) {
    if (file[0] !== "." && !file.endsWith(".d.ts")) {
      // ts uses / regardless of OS
      const fullPath = outDir + '/' +  file

      if (!file.includes(".")) {
        removedOld(fullPath, emittedFiles, promises)
        continue
      }

      if (!emittedFiles.has(fullPath)) {
        promises.push(unlink(fullPath))
      }
    }
  }
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