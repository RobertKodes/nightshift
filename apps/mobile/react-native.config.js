// expo-router installs these for its drawer and JS stack; the app uses neither (native stack, React Native's own
// Animated). Leaving them out of the native build keeps the app smaller and keeps their deep C++ paths out of
// Windows' 260-character limit.
const off = { platforms: { android: null, ios: null } };
module.exports = {
  dependencies: {
    "react-native-gesture-handler": off,
    "react-native-reanimated": off,
    "react-native-worklets": off,
  },
};
