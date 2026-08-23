// Monorepo-aware Metro config. pnpm's symlinked store means Metro must watch the workspace
// root (to resolve @free-wan/shared) and must NOT walk up the tree looking for a hoisted
// node_modules that pnpm never creates.
const { getDefaultConfig } = require('expo/metro-config')
const path = require('node:path')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

config.watchFolders = [workspaceRoot]
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
]
config.resolver.disableHierarchicalLookup = true
config.resolver.unstable_enableSymlinks = true

module.exports = config
