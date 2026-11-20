const { execSync } = require("node:child_process");
const path = require("node:path");

/**
 * Sign the packaged .app before DMG/ZIP.
 *
 * Default: ad-hoc (`-`) so GitHub downloads work the same on every Mac.
 * A machine-local "Meeting Cue Local" cert is NOT used for releases — other
 * machines can't verify it and Gatekeeper reports the app as damaged/crashed.
 *
 * Optional: MEETING_CUE_STABLE_SIGN=1 to use the local identity (dev TCC only).
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

  let signAs = "-";
  if (process.env.MEETING_CUE_STABLE_SIGN === "1") {
    try {
      const { ensureIdentity, IDENTITY } = require("./ensure-codesign-identity.cjs");
      signAs = ensureIdentity() || "-";
      if (signAs !== "-") signAs = IDENTITY;
    } catch (err) {
      console.warn("[afterPack] stable sign unavailable, using ad-hoc:", err);
      signAs = "-";
    }
  }

  execSync(
    `codesign --force --deep --sign ${JSON.stringify(signAs)} ${JSON.stringify(appPath)}`,
    { stdio: "inherit" }
  );
  console.log(`[afterPack] signed ${appPath} with ${signAs === "-" ? "ad-hoc" : signAs}`);
};
