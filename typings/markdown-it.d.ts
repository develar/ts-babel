declare module "markdown-it" {
  interface MarkdownItOptions {
    typographer?: boolean
    breaks?: boolean
  }

  interface MarkdownIt {
    enable(list: string | Array<string>, ignoreInvalid?: Boolean): MarkdownIt

    disable(list: string | Array<string>, ignoreInvalid?: Boolean): MarkdownIt

    render(src: string): string
  }

  function markdown(presetName?: string | MarkdownItOptions): MarkdownIt

  export = markdown
}