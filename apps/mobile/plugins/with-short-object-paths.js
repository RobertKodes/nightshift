// Windows keeps paths under 260 characters, and the app's C++ build names each object file after the full path of
// its source in node_modules, which runs past that. CMAKE_OBJECT_PATH_MAX makes CMake shorten those names with a
// hash instead (Android builds do not get the Windows default). Harmless on other systems.
const { withAppBuildGradle, createRunOncePlugin } = require('expo/config-plugins');

const MARK = '// nightshift: short object paths';

function withShortObjectPaths(config, { max = 200 } = {}) {
  return withAppBuildGradle(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (!src.includes(MARK)) {
      src = src.replace(
        /(\n\s*defaultConfig \{\n)/,
        `$1        ${MARK}\n        externalNativeBuild {\n            cmake {\n                arguments "-DCMAKE_OBJECT_PATH_MAX=${max}"\n            }\n        }\n`,
      );
    }
    cfg.modResults.contents = src;
    return cfg;
  });
}

module.exports = createRunOncePlugin(withShortObjectPaths, 'with-short-object-paths', '1.0.0');
