import * as ts from "typescript"
import * as path from "path"
import * as babel from "babel-core"
import { readdir, ensureDir, unlink, outputFile, readFile, outputJson } from "fs-extra-p"
import { Promise as BluebirdPromise } from "bluebird"
import { generateDeclarationFile } from "./declarationGenerator"
import markdown = require("markdown-it")

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

  const program = ts.createProgram(config.fileNames, compilerOptions)
  checkErrors(ts.getPreEmitDiagnostics(program))

  const outDir = compilerOptions.outDir
  if (outDir == null) {
    throw new Error("outDir is not specified in the compilerOptions")
  }

  await ensureDir(outDir)

  const target = compilerOptions.target || ts.ScriptTarget.Latest
  const fileToSourceMap: any = {}
  const promises: Array<BluebirdPromise<any>> = []
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

  if (tsConfig.docs != null) {
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

async function writeDocFile(docOutFile: string, content: string): Promise<void> {
  let existingContent: string = null
  try {
    existingContent = await readFile(docOutFile, "utf8")
  }
  catch (e) {
  }

  if (existingContent == null) {
    return outputFile(docOutFile, content)
  }
  else {
    const startMarker = "<!-- do not edit. start of generated block -->"
    const endMarker = "<!-- end of generated block -->"
    const start = existingContent.indexOf(startMarker)
    const end = existingContent.indexOf(endMarker)
    if (start != -1 && end != -1) {
      return outputFile(docOutFile, existingContent.substring(0, start + startMarker.length) + "\n" + content + "\n" + existingContent.substring(end))
    }
  }
  console.log("Write doc to " + docOutFile)
}

function generateDocs(program: ts.Program): string {
  const topicToProperties = new Map<InterfaceDescriptor, Map<string, PropertyDescriptor>>()

  for (let sourceFile of program.getSourceFiles()) {
    if (!sourceFile.isDeclarationFile) {
      for (let statement of sourceFile.statements) {
        if (statement.kind === ts.SyntaxKind.InterfaceDeclaration) {
          const topicName = getComment(statement)
          if (topicName == null) {
            continue
          }

          const interfaceDeclaration = <ts.InterfaceDeclaration>statement
          const interfaceName = (<ts.Identifier>interfaceDeclaration.name).text
          const interfaceDescriptor = {
            interfaceName: interfaceName,
            heading: topicName,
          }

          let nameToProperty = topicToProperties.get(interfaceDescriptor)
          for (let member of interfaceDeclaration.members) {
            if (member.kind === ts.SyntaxKind.PropertySignature) {
              const comment = getComment(member)
              if (comment != null) {
                if (nameToProperty == null) {
                  nameToProperty = new Map<string, PropertyDescriptor>()
                  topicToProperties.set(interfaceDescriptor, nameToProperty)
                }
                nameToProperty.set((<ts.Identifier>member.name).text, new PropertyDescriptor(interfaceName, comment))
              }
            }
          }
        }
      }
    }

    function getComment(node: ts.Node): string {
      const leadingCommentRanges = ts.getLeadingCommentRanges(sourceFile.text, node.pos)
      if (leadingCommentRanges == null || leadingCommentRanges.length === 0) {
        return null
      }
      else {
        const commentRange = leadingCommentRanges[0]
        return sourceFile.text.slice(commentRange.pos + "/**".length, commentRange.end - "*/".length).trim()
      }
    }
  }

  return renderDocs(topicToProperties)
}

function renderDocs(topicToProperties: Map<InterfaceDescriptor, Map<string, PropertyDescriptor>>): string {
  let result = ""
  const md = markdown({
    typographer: true,
  })
    .disable(["link", "emphasis"])

  topicToProperties.forEach((nameToProperty, interfaceDescriptor) => {
    result += `<a class="anchor" href="#${interfaceDescriptor.interfaceName}" aria-hidden="true"></a>\n${interfaceDescriptor.heading}\n`

    result += "| Name | Description\n"
    result += "| --- | ---"
    nameToProperty.forEach((descriptor, propertyName) => {
      result += `\n| <a class="anchor" href="#${descriptor.interfaceName}-${propertyName}" aria-hidden="true"></a>${propertyName} | `
      // trim is required because markdown-it adds new line in the end
      const src = descriptor.description
      result += src.includes("\n") ? md.render(src).trim().replace(/\n/g, " ") : src
    })

    result += "\n"
  })
  return result
}

export class InterfaceDescriptor {
  interfaceName: string
  heading: string
}

export class PropertyDescriptor {
  constructor(public interfaceName: string, public description: string) {
  }
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