import * as ts from "typescript"
import { JsDocGenerator, MethodDescriptor } from "./JsDocGenerator"
import { parse as parseJsDoc, Tag } from "doctrine"

export class JsDocRenderer {
  indent: string = ""
  currentSourceFile: ts.SourceFile

  constructor(private readonly generator: JsDocGenerator) {
  }

  formatComment(node: ts.Node, tags: Array<string>, description?: string): string {
    const indent = this.indent

    let result = `${indent}/**\n`

    if (description == null) {
      const comment = this.getComment(node)
      if (comment != null) {
        result += `${indent} ${comment.split("\n").map(it => it.trim()).filter(it => it != "*/").join(`\n${indent} `)}\n`
      }
    }
    else if (description.length > 0) {
      result += `${indent} * ${description}\n`
    }

    // must be added after user description
    if (tags.length > 0) {
      for (const tag of tags) {
        result += `${indent} * ${tag}\n`
      }
    }

    result += `${indent} */\n`
    return result
  }

  renderMethod(method: MethodDescriptor): string {
    const existingJsDoc = this.getComment(method.node)
    const parsed = existingJsDoc == null ? null : parseJsDoc(existingJsDoc, {unwrap: true})
    const tags = method.tags.slice()

    const paramNameToInfo = new Map<string, Tag>()
    let returns: Tag | null
    if (parsed != null) {
      for (const tag of parsed.tags) {
        if (tag.title === "param") {
          if (tag.name != null) {
            paramNameToInfo.set(tag.name, tag)
          }
        }
        else if (tag.title === "returns" || tag.title === "return") {
          returns = tag
        }
        else {
          tags.push(`@${tag.title} ${tag.description}`)
        }
      }
    }

    for (const param of method.node.parameters) {
      let name = (<ts.Identifier>param.name).text
      let text = `@param`
      const tag = paramNameToInfo.get(name)

      const type = param.type
      if (type != null) {
        text += ` {${this.generator.getTypeNamePathByNode(type)}}`
      }

      text += ` ${name}`
      if (tag != null) {
        text += ` ${tag.description}`
      }
      tags.push(text)
    }

    const signature = this.generator.program.getTypeChecker().getSignatureFromDeclaration(method.node)
    const returnType = this.generator.getTypeNamePath(signature.getReturnType())
    // http://stackoverflow.com/questions/4759175/how-to-return-void-in-jsdoc
    if (returnType !== "void") {
      let text = `@returns {${returnType}}`
      if (returns != null) {
        text += ` ${returns.description}`
      }
      tags.push(text)
    }

    let result = this.formatComment(method.node, tags, (parsed == null ? "" : parsed.description) || "")
    result += `${this.indent}`
    if (method.node.kind === ts.SyntaxKind.FunctionDeclaration) {
      result += "function "
    }
    result += `${method.name}() {}\n`
    return result
  }

  getComment(node: ts.Node): string | null {
    const sourceFile = this.currentSourceFile
    const leadingCommentRanges = ts.getLeadingCommentRanges(sourceFile.text, node.pos)
    if (leadingCommentRanges == null || leadingCommentRanges.length === 0) {
      return null
    }

    const commentRange = leadingCommentRanges[0]
    if (sourceFile.text[commentRange.pos] === "/" && sourceFile.text[commentRange.pos + 1] === "*" && sourceFile.text[commentRange.pos + 2] == "*") {
      return sourceFile.text.slice(commentRange.pos + 3, commentRange.end).trim()
    }
    return null
  }
}