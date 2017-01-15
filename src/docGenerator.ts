import * as ts from "typescript"
import { outputFile, readFile } from "fs-extra-p"
import markdown = require("markdown-it")

//noinspection JSUnusedLocalSymbols
const __awaiter = require("./awaiter")

export function generateDocs(program: ts.Program): Map<InterfaceDescriptor, Map<string, PropertyDescriptor>> {
  const topicToProperties = new Map<InterfaceDescriptor, Map<string, PropertyDescriptor>>()

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) {
      continue
    }

    for (const statement of sourceFile.statements) {
      if (statement.kind === ts.SyntaxKind.InterfaceDeclaration) {
        const description = getComment(statement, sourceFile)
        if (description == null) {
          continue
        }

        const lineBreakIndex = description.indexOf("\n")
        const header = description.substring(0, lineBreakIndex == -1 ? description.length : lineBreakIndex).replace(/`/g, "")

        const interfaceDeclaration = <ts.InterfaceDeclaration>statement
        const interfaceName = (<ts.Identifier>interfaceDeclaration.name).text
        const interfaceDescriptor = {
          name: interfaceName,
          description: description,
          header: header,
        }

        let nameToProperty = topicToProperties.get(interfaceDescriptor)
        for (const member of interfaceDeclaration.members) {
          if (member.kind === ts.SyntaxKind.PropertySignature) {
            let comment = getComment(member, sourceFile)
            if (comment == null) {
              continue
            }

            if (nameToProperty == null) {
              nameToProperty = new Map<string, PropertyDescriptor>()
              topicToProperties.set(interfaceDescriptor, nameToProperty)
            }
            const symbol: ts.Symbol = (<any>member).symbol


            let isOptional = symbol != null && (symbol.flags & ts.SymbolFlags.Optional) !== 0
            if (isOptional) {
              comment = comment
                .split("\n")
                .map(it => it.trim())
                .filter(it => {
                  if (it.startsWith("@required")) {
                    isOptional = false
                    return false
                  }
                  return true
                })
                .join("\n")
            }

            nameToProperty.set((<ts.Identifier>member.name).text, new PropertyDescriptor(interfaceName, comment, isOptional))
          }
        }
      }
    }
  }

  return topicToProperties
}

export async function writeDocFile(docOutFile: string, content: string): Promise<void> {
  let existingContent
  try {
    existingContent = await readFile(docOutFile, "utf8")
  }
  catch (e) {
  }

  console.log(`Write doc to ${docOutFile}`)
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
    else {
      return outputFile(docOutFile, content)
    }
  }
}

function stripIndent(str: string): string {
	const match = str.match(/^[ \t]*(?=\S)/gm)
  const indent = match == null ? 0 : Math.min.apply(Math, match.map(it => it.length))
  return indent > 0 ? str.replace(new RegExp("^[ \\t]{" + indent + "}", "gm"), "") : str
}

function getComment(node: ts.Node, sourceFile: ts.SourceFile): string {
  const leadingCommentRanges = ts.getLeadingCommentRanges(sourceFile.text, node.pos)
  if (leadingCommentRanges == null || leadingCommentRanges.length === 0) {
    return null
  }
  else {
    const commentRange = leadingCommentRanges[0]
    if (sourceFile.text[commentRange.pos] == "/" && sourceFile.text[commentRange.pos + 1] == "/") {
      return null
    }
    else {
      const isTwo = sourceFile.text[commentRange.pos + 2] == "*"
      return stripIndent(sourceFile.text.slice(commentRange.pos + (isTwo ? 3 : 2), commentRange.end - "*/".length)).trim()
    }
  }
}

export function writeToJs(program: ts.Program): string {
  let result = ""

  for (const sourceFile of program.getSourceFiles()) {
    if (!sourceFile.isDeclarationFile) {
      continue
    }

    for (const statement of sourceFile.statements) {
      if (statement.kind === ts.SyntaxKind.InterfaceDeclaration) {
        let description = getComment(statement, sourceFile)
        if (description == null) {
          continue
        }

        if (description.startsWith("#")) {
          const nextLineIndex = description.indexOf("\n")
          if (nextLineIndex > 0) {
            description = description.substring(nextLineIndex + 1).trim()
          }
        }

        const interfaceDeclaration = <ts.InterfaceDeclaration>statement
        const interfaceName = (<ts.Identifier>interfaceDeclaration.name).text

        result += `/**\n  * ${description}\n  */\n`
        result += `class ${interfaceName} {\n`

        for (const member of interfaceDeclaration.members) {
          if (member.kind === ts.SyntaxKind.PropertySignature) {
            const comment = getComment(member, sourceFile)
            if (comment != null) {
              result += `  /**\n  * ${comment}\n  */\n`
            }

            const symbol: ts.Symbol = (<any>member).symbol
            result += `  ${(<ts.Identifier>member.name).text}\n`
            // nameToProperty.set((<ts.Identifier>member.name).text, new PropertyDescriptor(interfaceName, comment, symbol != null && (symbol.flags & ts.SymbolFlags.Optional) !== 0))
          }
        }

        result += "}\n\n"
      }
    }
  }
  return result.trim()
}

export function renderDocs(topicToProperties: Map<InterfaceDescriptor, Map<string, PropertyDescriptor>>): string {
  let result = ""
  const md = markdown({
    typographer: true,
  })
    .disable(["link", "emphasis"])

  function render(src: string): string {
    return src.includes("\n") ? md.render(src).trim().replace(/\n/g, " ") : src
  }

  const keys = Array.from(topicToProperties.keys())

  let w = 0
  let subW = 0
  const topLevelKeys = new Map<string, number>()
  for (const interfaceDescriptor of keys) {
    const header = interfaceDescriptor.header
    if (header.startsWith("# ")) {
      // # Development `package.json`
      if (!topLevelKeys.has(header)) {
        topLevelKeys.set(header, w += 1000)
      }
    }
    else {
      //  ### .build.mac
      let key = header.split(".")[1]
      if (!topLevelKeys.has(key)) {
        topLevelKeys.set(key, subW += 100000)
      }
    }
  }

  function headerWeight(text: string): number {
    let weight = 0

    for (let k of topLevelKeys.keys()) {
      //  ## `.build`
      if (text.endsWith(`.${k}`) || text.includes(`.${k}.`)) {
        weight = topLevelKeys.get(k)
        break
      }
    }

    for (let i = 0; i < text.length; i++) {
      if (text[i] == "#") {
        weight += 1
      }
      else {
        break
      }
    }
    return weight
  }

  keys.sort(function (a, b) {
    const n1 = a.header
    const n2 = b.header

    const hDiff = headerWeight(n1) - headerWeight(n2)
    if (hDiff != 0) {
      return hDiff
    }

    return n1.localeCompare(n2)
  })

  // toc
  let tocHeaderOffset = 0
  for (const interfaceDescriptor of keys) {
    let header = interfaceDescriptor.header

    for (let i = 0; i < header.length; i++) {
      if (header[i] != "#") {
        if (i > 0) {
          if (result === "") {
            tocHeaderOffset = i
          }
          result += "  ".repeat(i - tocHeaderOffset)
        }
        result += "* "

        header = `[${header.substring(i).trim()}](#${interfaceDescriptor.name})`
        break
      }
    }

    result += header + "\n"
  }

  for (const interfaceDescriptor of keys) {
    const nameToProperty = topicToProperties.get(interfaceDescriptor)
    result += `\n${anchor(interfaceDescriptor.name)}\n${interfaceDescriptor.description}\n`
    if (interfaceDescriptor.description.includes("\n")) {
      result += "\n"
    }

    result += "| Name | Description\n"
    result += "| --- | ---"
    nameToProperty.forEach((descriptor, propertyName) => {
      let bold = descriptor.isOptional ? "" : "**"
      result += `\n| ${bold}${propertyName}${bold} | `

      //  put anchor in the text because if multiline, name will be aligned vertically and on on navigation top of the text will be out of screen
      result += anchor(descriptor.interfaceName + "-" + propertyName)

      // trim is required because markdown-it adds new line in the end
      result += render(descriptor.description)
    })

    result += "\n"
  }
  return result
}

function anchor(link: string) {
  return `<a name="${link}"></a>`
}

export class InterfaceDescriptor {
  name: string
  header: string
  description: string
}

export class PropertyDescriptor {
  constructor(public interfaceName: string, public description: string, public isOptional: Boolean) {
  }
}