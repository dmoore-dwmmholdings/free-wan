// Monorepo-aware Metro config for a pnpm workspace.
//
// Metro must watch the workspace root so @free-wan/shared resolves through its symlink.
// Note what is deliberately NOT set: `disableHierarchicalLookup`. That flag is the usual
// advice for npm/yarn monorepos, but pnpm nests each package's own dependencies under
// node_modules/.pnpm/<pkg>/node_modules/, which Metro reaches only by walking up from the
// importing file. Disabling that lookup breaks every transitive dependency of expo-router.
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
config.resolver.unstable_enableSymlinks = true

module.exports = config
