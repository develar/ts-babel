declare module "@babel/core" {
  interface TransformResult {
    code: string
    map: string
  }

  function transform(code: string, options: any): TransformResult

  interface OptionManager {

  }
}