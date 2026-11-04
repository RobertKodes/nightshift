// Pins the NDK the build uses (expo-build-properties has no ndkVersion option in SDK 58).
// Expo's root plugin reads rootProject.ext.ndkVersion before falling back to React Native's default.
const { withProjectBuildGradle, createRunOncePlugin } = require('expo/config-plugins');

function withNdkVersion(config, { version }) {
  return withProjectBuildGradle(config, (cfg) => {
    const line = `ext.ndkVersion = "${version}"`;
    let src = cfg.modResults.contents.replace(/^ext\.ndkVersion = .*\n/m, '');
    src = src.replace(/^buildscript \{/m, `${line}\n\nbuildscript {`);
    cfg.modResults.contents = src;
    return cfg;
  });
}

module.exports = createRunOncePlugin(withNdkVersion, 'with-ndk-version', '1.0.0');
