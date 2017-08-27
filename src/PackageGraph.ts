// lerna

export class PackageGraphNode {
  readonly dependencies: Array<string> = []

  constructor(readonly metadata: any) {
  }
}

export interface PackageMetadata {
  name: string
}

export class PackageGraph {
  readonly nodes: Array<PackageGraphNode> = []
  readonly nodesByName: any = {}

  constructor(readonly packageMetadataList: Array<PackageMetadata>) {
    for (const packageMetadata of packageMetadataList) {
      const node = new PackageGraphNode(packageMetadata)
      this.nodes.push(node)
      this.nodesByName[packageMetadata.name] = node
    }

    for (const node of this.nodes) {
      const addDeps = (dependencies: Array<any>) => {
        const depNames = Object.keys(dependencies)
        for (const depName of depNames) {
          const packageNode = this.nodesByName[depName]
          if (packageNode != null) {
            node.dependencies.push(depName)
          }
        }
      }

      const dependencies = node.metadata.dependencies
      if (dependencies != null) {
        addDeps(dependencies)
      }
      const peerDependencies = node.metadata.peerDependencies
      if (peerDependencies != null) {
        addDeps(peerDependencies)
      }
    }
  }

  get(packageName: string): PackageGraphNode {
    return this.nodesByName[packageName]
  }
}


export function topologicallyBatchPackages(packages: Array<any>) {
  packages = packages.slice()
  const packageGraph = new PackageGraph(packages)

  // This maps package names to the number of packages that depend on them.
  // As packages are completed their names will be removed from this object.
  const refCounts: any = {}
  for (const pkg of packages) {
    for (const dep of packageGraph.get(pkg.name).dependencies) {
      if (refCounts[dep] == null) {
        refCounts[dep] = 0
      }
      refCounts[dep]++
    }
  }

  const batches = []
  while (packages.length > 0) {
    // Get all packages that have no remaining dependencies within the repo that haven't yet been picked.
    const batch = packages.filter(pkg => {
      const node = packageGraph.get(pkg.name)
      return node.dependencies.filter(dep => refCounts[dep]).length == 0
    });

    // If we weren't able to find a package with no remaining dependencies,
    // then we've encountered a cycle in the dependency graph.  Run a single-package batch with the package that has the most dependents.
    if (packages.length > 0 && !batch.length) {
      console.warn("Encountered a cycle in the dependency graph. This may cause instability!")
      batch.push(packages.reduce((a, b) => (refCounts[a.name] || 0) > (refCounts[b.name] || 0) ? a : b))
    }

    batches.push(batch)

    for (const pkg of batch) {
      delete refCounts[pkg.name]
      packages.splice(packages.indexOf(pkg), 1)
    }
  }

  return batches
}
