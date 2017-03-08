import * as ts from "typescript";
import * as path from "path";
import {readFile} from "fs-extra-p";

//noinspection JSUnusedLocalSymbols
const __awaiter = require("./awaiter")

export async function transpile(transpilator: (basePath: string, config: ts.ParsedCommandLine, tsConfig: any) => Promise<any>) {
  const paths = process.argv.slice(2)
  if (paths.length == 0) {
    paths.push(process.cwd())
  }
  return transpilePaths(paths, transpilator)
}

export async function transpilePaths(paths: Array<string>, transpilator: (basePath: string, config: ts.ParsedCommandLine, tsConfig: any) => Promise<any>) {
  for (const basePath of paths) {
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

        const location = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
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
  const jsonResult = ts.parseConfigFileTextToJson(tsConfigPath, await readFile(tsConfigPath, "utf8"))
  if (jsonResult.error != null) {
    throw new CompilationError([jsonResult.error])
  }

  const result = ts.parseJsonConfigFileContent(jsonResult.config, ts.sys, basePath)
  checkErrors(result.errors)

  await transpilator(basePath, result, jsonResult.config)
}

export function checkErrors(errors: Array<ts.Diagnostic>): void {
  if (errors.length !== 0) {
    throw new CompilationError(errors)
  }
}

class CompilationError extends Error {
  constructor(public errors: Array<ts.Diagnostic>) {
    super("Compilation error")
  }
}

export function processTree(sourceFile: ts.SourceFile, replacer: (node: ts.Node) => string): string {
  let code = '';
  let cursorPosition = 0;

  function skip(node: ts.Node) {
    cursorPosition = node.end;
  }

  function readThrough(node: ts.Node) {
    code += sourceFile.text.slice(cursorPosition, node.pos);
    cursorPosition = node.pos;
  }

  function visit(node: ts.Node) {
    readThrough(node);

    if (node.flags & ts.ModifierFlags.Private) {
      // skip private nodes
      skip(node)
      return
    }

    if (node.kind === ts.SyntaxKind.ImportDeclaration && (<ts.ImportDeclaration>node).importClause == null) {
      // ignore side effects only imports (like import "source-map-support/register")
      skip(node)
      return
    }

    const replacement = replacer(node)
    if (replacement != null) {
      code += replacement
      skip(node)
    }
    else {
      if (node.kind === ts.SyntaxKind.ClassDeclaration || node.kind === ts.SyntaxKind.InterfaceDeclaration || node.kind === ts.SyntaxKind.FunctionDeclaration) {
        code += "\n"
      }
      ts.forEachChild(node, visit)
    }
  }

  visit(sourceFile)
  code += sourceFile.text.slice(cursorPosition)

  return code
}