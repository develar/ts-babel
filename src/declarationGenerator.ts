import { createWriteStream, mkdirs } from 'fs-extra-p'
import * as path from 'path'
import BluebirdPromise from "bluebird-lst"
import * as ts from 'typescript'
import { processTree } from "./util"

//noinspection JSUnusedLocalSymbols
const __awaiter = require("./awaiter")

const filenameToMid: (filename: string) => string = (function () {
  if (path.sep === '/') {
    return (it: string) => it
  }
  else {
    const separatorExpression = new RegExp(path.sep.replace('\\', '\\\\'), 'g');
    return (it: string) => it.replace(separatorExpression, '/')
  }
})();

export async function generateDeclarationFile(moduleName: string, declarationFiles: Array<ts.SourceFile>, compilerOptions: ts.CompilerOptions, out: string, basePath: string, mainFile: string): Promise<any> {
  console.log(`Generating d.ts to ${out}`)

  const fileNameToModuleId: any = {}

  const relativeOutDir = path.relative(basePath, compilerOptions.outDir)

  await mkdirs(path.dirname(out))

  const eol = "\n"
  const indent: string = "  "
  const output = createWriteStream(out, {mode: parseInt('644', 8)})
  return await new BluebirdPromise<void>((resolve, reject) => {
    output.on("finish", resolve)
    output.on("error", reject)

    for (const sourceFile of declarationFiles) {
      writeDeclaration(sourceFile, compilerOptions, relativeOutDir)
    }

    output.end()
  })

  function writeDeclaration(declarationFile: ts.SourceFile, compilerOptions: ts.CompilerOptions, relativeOutDir: string) {
    if (declarationFile.text.length === 0) {
      return
    }

    let sourceModuleId: string
    let baseName = ""
    const fileNameWithoutExt = declarationFile.fileName.slice(0, -5).replace(/\\/g, "/")
    const name = fileNameWithoutExt.substring(compilerOptions.outDir.length + 1)
    if (moduleName) {
      baseName = moduleName + '/'
      sourceModuleId = moduleName
      if (name !== "index") {
        sourceModuleId += '/' + relativeOutDir
      }
    }
    else {
      sourceModuleId = relativeOutDir
    }

    baseName += relativeOutDir

    const parentDir = name.includes("/") ? `${baseName}/${path.dirname(name)}` : baseName
    if (name !== "index") {
      sourceModuleId += '/' + name
    }

    if (declarationFile.fileName.endsWith("main.d.ts") || (mainFile != null && `${fileNameWithoutExt}.js`.includes(mainFile))) {
      sourceModuleId = moduleName
    }

    output.write(`declare module "${sourceModuleId}" {${eol}${indent}`)
    fileNameToModuleId[path.resolve(fileNameWithoutExt).replace(/\\/g, "/")] = sourceModuleId

    const mainBasename = path.basename(mainFile, ".js")

    const content = processTree(declarationFile, (node) => {
      if (node.kind === ts.SyntaxKind.ExternalModuleReference) {
        const expression = <ts.LiteralExpression> (<ts.ExternalModuleReference> node).expression;

        if (expression.text.charAt(0) === '.') {
          return ' require(\'' + filenameToMid(path.join(path.dirname(sourceModuleId), expression.text)) + '\')';
        }
      }
      else if (node.kind === ts.SyntaxKind.DeclareKeyword) {
        return ''
      }
      else if (node.kind === ts.SyntaxKind.StringLiteral && (node.parent.kind === ts.SyntaxKind.ExportDeclaration || node.parent.kind === ts.SyntaxKind.ImportDeclaration)) {
        const text = (<ts.LiteralLikeNode> node).text

        if (text.charAt(0) === '.') {
          if (text.charAt(1) === '.') {
            const m = fileNameToModuleId[path.resolve(path.dirname(declarationFile.fileName), text).replace(/\\/g, "/")]
            if (m != null) {
              return ` "${m}"`
            }
            return ` "${baseName}/${text.substring(3)}"`
          }
          else {
            if (text.charAt(1) === '/' && text.substring(2) === mainBasename) {
              return ` "${moduleName}"`
            }
            return ` "${parentDir}/${text.substring(2)}"`
          }
        }
      }

      return null
    });

    let prev = content.replace(new RegExp(eol + '(?!' + eol + '|$)', 'g'), '$&' + indent);
    prev = prev.replace(/;/g, '')
    if (indent != "    ") {
      prev = prev.replace(/    /g, indent)
    }

    output.write(prev)
    if (prev.charAt(prev.length - 1) != '\n') {
      output.write(eol)
    }
    output.write('}' + eol + eol)
  }
}