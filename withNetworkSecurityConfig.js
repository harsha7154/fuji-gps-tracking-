/**
 * Expo config plugin: make the Android release build trust the Liferay server's
 * certificate (needed because https://13.233.171.171:8443 uses a certificate that
 * Android does not trust by default).
 *
 * Expects the server certificate (public part only, DER or PEM) at ./certs/server.cer
 * What it generates on `expo prebuild`:
 *   android/app/src/main/res/raw/fuji_server_cert.cer
 *   android/app/src/main/res/xml/network_security_config.xml
 *   android:networkSecurityConfig="@xml/network_security_config" on <application>
 */
const fs = require('fs');
const path = require('path');
const { withDangerousMod, withAndroidManifest } = require('@expo/config-plugins');

const CERT_SOURCE = path.join('certs', 'server.cer');
const SERVER_HOST = '13.233.171.171';

const XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="true">
    <trust-anchors>
      <certificates src="system" />
    </trust-anchors>
  </base-config>
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">${SERVER_HOST}</domain>
    <trust-anchors>
      <certificates src="system" />
      <certificates src="@raw/fuji_server_cert" />
    </trust-anchors>
  </domain-config>
</network-security-config>
`;

function withCertFiles(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const src = path.join(projectRoot, CERT_SOURCE);
      if (!fs.existsSync(src)) {
        throw new Error(
          `[withNetworkSecurityConfig] Server certificate not found at ${CERT_SOURCE}. ` +
            'Export it (see instructions) and place it there before building.'
        );
      }
      const resDir = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res');
      fs.mkdirSync(path.join(resDir, 'raw'), { recursive: true });
      fs.mkdirSync(path.join(resDir, 'xml'), { recursive: true });
      fs.copyFileSync(src, path.join(resDir, 'raw', 'fuji_server_cert.cer'));
      fs.writeFileSync(path.join(resDir, 'xml', 'network_security_config.xml'), XML);
      return cfg;
    },
  ]);
}

function withManifestAttr(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (!app) throw new Error('[withNetworkSecurityConfig] <application> not found');
    app.$['android:networkSecurityConfig'] = '@xml/network_security_config';
    return cfg;
  });
}

module.exports = function withNetworkSecurityConfig(config) {
  return withManifestAttr(withCertFiles(config));
};
