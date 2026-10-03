const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Radio-appen laaner sin kode fra @norstream/app og @norstream/core, som
// ligger i samme arbejdsomraade. Uden watchFolders ser Metro dem ikke.
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.assetExts.push('wasm');

/**
 * Ét eksemplar af de pakker der ikke taaler to.
 *
 * packages/app har sin egen react-native (tv-udgaven) i sit eget
 * node_modules, og naar Metro foelger en import derfra, ville den finde
 * *den* — og appen ville ende med to React Native i samme bundle, som
 * gaar ned ved start. Alt der hedder react, react-native eller expo
 * opløses derfor som var det importeret fra denne app.
 */
const SINGLE = /^(react|react-dom|react-native|react-native-safe-area-context|react-native-web|expo|expo-[a-z-]+)(\/.*)?$/;

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = (ctx, name) =>
    defaultResolveRequest ? defaultResolveRequest(ctx, name, platform) : ctx.resolveRequest(ctx, name, platform);
  if (SINGLE.test(moduleName)) {
    return resolve({ ...context, originModulePath: path.join(projectRoot, 'index.ts') }, moduleName);
  }
  try {
    return resolve(context, moduleName);
  } catch (error) {
    // .js-endelser i imports der peger paa .ts-filer (NodeNext-stil i core og app).
    if (moduleName.endsWith('.js')) {
      const base = moduleName.slice(0, -3);
      for (const ext of ['.ts', '.tsx']) {
        try {
          return resolve(context, base + ext);
        } catch {
          // Naeste endelse.
        }
      }
    }
    throw error;
  }
};

module.exports = config;
