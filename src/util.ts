import * as ts from "typescript"
import * as path from "path"
import { promises as fs } from "fs"
import * as bluebird from "bluebird"
import { topologicallyBatchPackages } from "./PackageGraph"

const globSuffix = "/*"

export async function transpile(transpilator: (basePath: string, config: ts.ParsedCommandLine, tsConfig: any) => Promise<any>) {
  const paths = process.argv.slice(2)
  if (paths.length == 0) {
    paths.push(process.cwd())
  }

  if (paths[0].endsWith(globSuffix)) {
    const packageDir = paths[0].substring(0, paths[0].length - 2)
    const packageMetadata = await readProjectMetadata(packageDir)
    const toCompile = topologicallyBatchPackages(packageMetadata)
    await bluebird.mapSeries(toCompile, it => {
      console.log(`Building ${it.map(it => it.name).join(", ")}`)
      return transpilePaths(it.map(it => path.join(packageDir, it.name)), transpilator, false)
    })
  }
  await transpilePaths(paths.filter(it => !it.endsWith(globSuffix)), transpilator, true)
}

export async function readProjectMetadata(packageDir: string) {
  const packageDirs = bluebird.filter((await fs.readdir(packageDir)).filter(it => !it.includes(".")).sort(), it => {
    return fs.stat(path.join(packageDir, it, "tsconfig.json"))
      .then(it => it.isFile())
      .catch(() => false)
  })
  return await bluebird.map(packageDirs, it => fs.readFile(path.join(packageDir, it, "package.json"), "utf-8").then(it => JSON.parse(it)), {concurrency: 8})
}

async function transpilePaths(paths: Array<string>, transpilator: (basePath: string, config: ts.ParsedCommandLine, tsConfig: any) => Promise<any>, isLogBuilding: boolean) {
  for (const basePath of paths) {
    if (isLogBuilding) {
      console.log(`Building ${basePath}`)
    }

    try {
      await build(basePath, transpilator)
    }
    catch (e) {
      if (!(e instanceof CompilationError)) {
        throw e
      }

      for (const diagnostic of e.errors) {
        if (diagnostic.file == null) {
          console.log(diagnostic.messageText)
          continue
        }

        const location = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start!!)
        const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
        console.log(`${diagnostic.file.fileName} (${location.line + 1}, ${location.character + 1}): ${message}`)
      }
      process.exit(-1)
      return
    }
  }
}

async function build(basePath: string, transpilator: (basePath: string, config: ts.ParsedCommandLine, tsConfig: any) => Promise<any>) {
  const tsConfigPath = path.join(basePath, "tsconfig.json")
  const jsonResult = ts.parseConfigFileTextToJson(tsConfigPath, await fs.readFile(tsConfigPath, "utf8"))
  if (jsonResult.error != null) {
    throw new CompilationError([jsonResult.error])
  }

  const result = ts.parseJsonConfigFileContent(jsonResult.config, ts.sys, basePath)
  checkErrors(result.errors)

  await transpilator(basePath, result, jsonResult.config)
}

export function checkErrors(errors: ReadonlyArray<ts.Diagnostic>): void {
  if (errors.length !== 0) {
    throw new CompilationError(errors)
  }
}

class CompilationError extends Error {
  constructor(public errors: ReadonlyArray<ts.Diagnostic>) {
    super("Compilation error")
  }
}