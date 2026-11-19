const { execSync } = require("node:child_process");
const path = require("node:path");

/**
 * Ad-hoc sign the .app so macOS Gatekeeper doesn't report unsigned Electron
 * builds as "damaged" when no Developer ID is available.
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);

  try {
    execSync(`xattr -cr ${JSON.stringify(appPath)}`, { stdio: "inherit" });
  } catch {
    /* ignore */
  }

  execSync(
    `codesign --force --deep --sign - ${JSON.stringify(appPath)}`,
    { stdio: "inherit" }
  );
  console.log(`[afterPack] ad-hoc signed ${appPath}`);
};
