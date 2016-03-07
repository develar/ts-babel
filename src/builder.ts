import * as ts from "typescript"
import * as path from "path"
import * as babel from "babel-core"
import { readdir, ensureDir, unlink, writeFile, readFile } from "fs-extra-p"
import { Promise as BluebirdPromise } from "bluebird"

if (process.argv.length === 3) {
  process.chdir(path.resolve(process.argv[2]))
}

const basePath = process.cwd()
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

  await ensureDir(outDir)

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