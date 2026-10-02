// Monorepo-aware Metro config for a pnpm workspace.
//
// Only two overrides, both additive: watch the workspace root so @free-wan/shared resolves
// through its symlink, and let Metro fall back to the root store for packages pnpm keeps
// there. Note what is deliberately NOT set — `disableHierarchicalLookup`, the usual advice
// for npm/yarn monorepos. pnpm nests each package's dependencies under
// node_modules/.pnpm/<pkg>/node_modules/, which Metro reaches only by walking up from the
// importing file, so disabling that lookup breaks every transitive dependency of expo-router.
const { getDefaultConfig } = require('expo/metro-config')
const path = require('node:path')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

config.watchFolders = [...(config.watchFolders ?? []), workspaceRoot]
config.resolver.nodeModulesPaths = [
  ...(config.resolver.nodeModulesPaths ?? []),
  path.resolve(workspaceRoot, 'node_modules'),
]

module.exports = config
