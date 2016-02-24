import * as ts from "typescript"
import * as path from "path"
import * as babel from "babel-core"
import * as fse from "fs-extra"
import { Promise as BluebirdPromise } from "bluebird"

const basePath = process.cwd()
const tsConfigPath = path.join(basePath, "tsconfig.json")

const writeFile = <((filename: string, data: string) => BluebirdPromise<any>)>BluebirdPromise.promisify(fse.writeFile)
const readFile = <((filename: string, encoding?: string) => BluebirdPromise<string | Buffer>)>BluebirdPromise.promisify(fse.readFile)
const unlink = BluebirdPromise.promisify(fse.unlink)

main()
  .catch(error => {
    if (error instanceof CompilationError) {
      for (let diagnostic of error.errors) {
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
  const result = ts.parseConfigFileTextToJson(tsConfigPath, await readText(tsConfigPath))
  if (result.error != null) {
    throw new CompilationError([result.error])
  }

  // we check it before in any case
  result.config.noEmitOnError = false
  return compile(result.config)
}

async function compile(config: any) {
  const compilerOptions = ts.convertCompilerOptionsFromJson(config.compilerOptions, basePath)
  checkErrors(compilerOptions.errors)

  const program = ts.createProgram(config.files, compilerOptions.options)
  checkErrors(ts.getPreEmitDiagnostics(program))

  const outDir = compilerOptions.options.outDir
  if (outDir == null) {
    throw new Error("outDir is not specified in the compilerOptions")
  }

  await BluebirdPromise.promisify(fse.ensureDir)(outDir)

  const fileToSourceMap: any = {}
  const promises: Array<BluebirdPromise<any>> = []
  const emittedFiles = new Set<string>()
  program.emit(undefined, (fileName, data) => {
    emittedFiles.add(fileName)

    if (fileName.endsWith(".js")) {
      const sourceMapFileName = fileName + ".map"
      processCompiled(data, fileToSourceMap[sourceMapFileName], fileName, sourceMapFileName, promises)
    }
    else if (fileName.endsWith(".js.map")) {
      fileToSourceMap[fileName] = data
    }
  })

  await BluebirdPromise.all(promises)

  promises.length = 0
  await removedOld(outDir, emittedFiles, promises)
  return await BluebirdPromise.all(promises)
}

async function removedOld(outDir: string, emittedFiles: Set<string>, promises: Array<BluebirdPromise<any>>) {
  const files = await BluebirdPromise.promisify(fse.readdir)(outDir)
  for (let file of files) {
    const fullPath = path.join(outDir, file)
    if (file[0] !== "." && !emittedFiles.has(fullPath) && !file.endsWith(".d.ts")) {
      promises.push(unlink(fullPath))
    }
  }
}

function processCompiled(code: string, sourceMap: string, jsFileName: string, sourceMapFileName: string, promises: Array<BluebirdPromise<any>>) {
  const result = babel.transform(code, {
    inputSourceMap: JSON.parse(sourceMap),
    sourceMaps: true,
    filename: jsFileName,
  })

  promises.push(
    writeFile(jsFileName, result.code),
    writeFile(sourceMapFileName, JSON.stringify(result.map)))
}

function checkErrors(errors: Array<ts.Diagnostic>): void {
  if (errors.length !== 0) {
    throw new CompilationError(errors)
  }
}

//noinspection JSUnusedLocalSymbols
function __awaiter(thisArg: any, _arguments: any, ignored: any, generator: Function) {
  return BluebirdPromise.coroutine(generator).call(thisArg, _arguments)
}

function readText(file: string): BluebirdPromise<string> {
  return <BluebirdPromise<string>>readFile(file, "utf8")
}

class CompilationError extends Error {
  constructor(public errors: Array<ts.Diagnostic>) {
    super("Compilation error")
  }
}