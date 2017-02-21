import BluebirdPromise from "bluebird-lst"
import "source-map-support/register"

export = function tsAwaiter(thisArg: any, _arguments: any, ignored: any, generator: Function) {
  return BluebirdPromise.coroutine(generator).call(thisArg, _arguments)
}
