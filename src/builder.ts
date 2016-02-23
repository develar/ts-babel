import * as ts from "typescript"
import * as fs from "fs"
import * as path from "path"
import * as babel from "babel-core"

const basePath = process.cwd()
const tsConfigPath = path.join(basePath, "tsconfig.json")
fs.readFile(tsConfigPath, "utf8", (readError, data) => {
  if (readError != null) {
    throw readError
  }

  const {config, error} = ts.parseConfigFileTextToJson(tsConfigPath, data)
  if (error == null || !printErrors([error])) {
    // we check it before in any case
    config.noEmitOnError = false
    compile(config)
  }
})

function compile(config: any) {
  const compilerOptions = ts.convertCompilerOptionsFromJson(config.compilerOptions, basePath)
  if (printErrors(compilerOptions.errors)) {
    return
  }

  const program = ts.createProgram(config.files, compilerOptions.options)
  if (printErrors(ts.getPreEmitDiagnostics(program))) {
    return
  }

  const outDir = compilerOptions.options.outDir
  if (outDir == null) {
    throw new Error("outDir is not specified in the compilerOptions")
  }

  const fileToSourceMap: any = {}
  program.emit(undefined, (fileName, data) => {
    if (endsWith(fileName, ".js")) {
      const sourceMapFileName = fileName + ".map"
      processCompiled(data, fileToSourceMap[sourceMapFileName], fileName, sourceMapFileName)
    }
    else if (endsWith(fileName, ".js.map")) {
      fileToSourceMap[fileName] = data
    }
  })
}

function processCompiled(code: string, sourceMap: string, jsFileName: string, sourceMapFileName: string) {
  const result = babel.transform(code, {
    inputSourceMap: JSON.parse(sourceMap),
    sourceMaps: true,
    filename: jsFileName,
  })

  const handler = (e: Error) => { if (e != null) throw e }
  fs.writeFile(jsFileName, result.code, handler)
  fs.writeFile(sourceMapFileName, JSON.stringify(result.map), handler)
}

function printErrors(errors: Array<ts.Diagnostic>): boolean {
  if (errors.length === 0) {
    return false
  }

  for (let diagnostic of errors) {
    const {line, character} = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
    console.log(`${diagnostic.file.fileName} (${line + 1},${character + 1}): ${message}`)
  }

  process.exit(1)
  return true
}

function endsWith(subjectString: string, searchString: string) {
  const position = subjectString.length - searchString.length
  const lastIndex = subjectString.indexOf(searchString, position)
  return lastIndex !== -1 && lastIndex === position
}
