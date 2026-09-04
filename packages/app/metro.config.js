const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Uden watchFolders ser Metro ikke packages/core, og importen fejler.
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// Hindrer at en pakke oploeses to gange fra to node_modules-mapper.
config.resolver.disableHierarchicalLookup = true;

// expo-sqlite's web-worker importerer en .wasm-fil (wa-sqlite), men Metro's
// standard assetExts kender ikke .wasm, saa bundlingen fejlede paa web med
// "Unable to resolve wa-sqlite.wasm". Uden dette kunne databasen slet ikke
// aabnes paa web. Paavirker ikke native builds.
config.resolver.assetExts.push('wasm');

// @uhf-play/core bruger eksplicitte .js-endelser i sine imports (NodeNext-stil),
// selvom filerne er .ts. Metro kender ikke den mapning som standard, saa vi
// falder tilbage til .ts/.tsx naar en .js-sti ikke kan opløses direkte.
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = (name) =>
    defaultResolveRequest
      ? defaultResolveRequest(context, name, platform)
      : context.resolveRequest(context, name, platform);

  if (moduleName.endsWith('.js')) {
    try {
      return resolve(moduleName);
    } catch (error) {
      const withoutExt = moduleName.slice(0, -3);
      for (const ext of ['.ts', '.tsx']) {
        try {
          return resolve(withoutExt + ext);
        } catch {
          // proev naeste endelse
        }
      }
      throw error;
    }
  }

  return resolve(moduleName);
};

module.exports = config;
