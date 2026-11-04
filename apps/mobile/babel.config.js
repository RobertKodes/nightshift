// unstable_transformImportMeta: AppKit's state library (valtio) uses import.meta.
// No reanimated or worklets: the app animates with React Native's own Animated (see react-native.config.js).
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { unstable_transformImportMeta: true, reanimated: false, worklets: false }]],
  };
};
