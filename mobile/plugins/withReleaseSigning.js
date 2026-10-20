// Signs release builds with your own key when it's set up in ~/.gradle/gradle.properties:
//   LUMEN_STORE_FILE=/path/to/lumen-release.keystore
//   LUMEN_STORE_PASSWORD=…  LUMEN_KEY_ALIAS=lumen  LUMEN_KEY_PASSWORD=…
// Without those, release builds fall back to the debug key (fine for testing only).
const { withAppBuildGradle } = require('expo/config-plugins')

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let g = cfg.modResults.contents
    if (g.includes('LUMEN_STORE_FILE')) return cfg
    g = g.replace(
      /signingConfigs \{\n(\s*)debug \{/,
      `signingConfigs {
$1release {
$1    if (project.hasProperty('LUMEN_STORE_FILE')) {
$1        storeFile file(LUMEN_STORE_FILE)
$1        storePassword LUMEN_STORE_PASSWORD
$1        keyAlias LUMEN_KEY_ALIAS
$1        keyPassword LUMEN_KEY_PASSWORD
$1    }
$1}
$1debug {`,
    )
    g = g.replace(
      /(buildTypes \{[\s\S]*?release \{[\s\S]*?)signingConfig signingConfigs\.debug/,
      `$1signingConfig project.hasProperty('LUMEN_STORE_FILE') ? signingConfigs.release : signingConfigs.debug`,
    )
    cfg.modResults.contents = g
    return cfg
  })
}
