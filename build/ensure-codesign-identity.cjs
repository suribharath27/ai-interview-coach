/**
 * Ensure a stable self-signed codesign identity exists so macOS TCC
 * (Screen / System Audio) keeps matching the same Meeting Cue across rebuilds.
 * Ad-hoc (`codesign -s -`) creates a new identity every build → duplicate rows.
 */
const { execFileSync, execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const IDENTITY = "Meeting Cue Local";
const CERT_DIR = path.join(__dirname, ".signing");
const KEY_PATH = path.join(CERT_DIR, "meeting-cue-local.key");
const CRT_PATH = path.join(CERT_DIR, "meeting-cue-local.crt");
const P12_PATH = path.join(CERT_DIR, "meeting-cue-local.p12");
const CFG_PATH = path.join(CERT_DIR, "openssl.cnf");
const P12_PASS = "meeting-cue-local";

function hasIdentity() {
  try {
    // Include untrusted identities — macOS lists them without -v; codesign still works
    // and keeps a stable TCC identity across rebuilds.
    const out = execFileSync("security", ["find-identity", "-p", "codesigning"], {
      encoding: "utf8",
    });
    return out.includes(IDENTITY);
  } catch {
    return false;
  }
}

function ensureIdentity() {
  if (process.platform !== "darwin") return null;
  if (hasIdentity()) {
    console.log(`[codesign] using existing identity "${IDENTITY}"`);
    return IDENTITY;
  }

  fs.mkdirSync(CERT_DIR, { recursive: true });
  fs.writeFileSync(
    CFG_PATH,
    `[req]
distinguished_name = req_distinguished_name
x509_extensions = v3_codesign
prompt = no

[req_distinguished_name]
CN = ${IDENTITY}
O = Meeting Cue
C = US

[v3_codesign]
basicConstraints = CA:FALSE
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
subjectKeyIdentifier = hash
`
  );

  console.log(`[codesign] creating self-signed code-signing cert "${IDENTITY}"…`);
  execSync(
    [
      "openssl",
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-sha256",
      "-days",
      "3650",
      "-nodes",
      `-keyout ${JSON.stringify(KEY_PATH)}`,
      `-out ${JSON.stringify(CRT_PATH)}`,
      `-config ${JSON.stringify(CFG_PATH)}`,
      `-extensions v3_codesign`,
    ].join(" "),
    { stdio: "inherit" }
  );

  execSync(
    [
      "openssl",
      "pkcs12",
      "-export",
      `-inkey ${JSON.stringify(KEY_PATH)}`,
      `-in ${JSON.stringify(CRT_PATH)}`,
      `-out ${JSON.stringify(P12_PATH)}`,
      `-passout pass:${P12_PASS}`,
      `-name ${JSON.stringify(IDENTITY)}`,
    ].join(" "),
    { stdio: "inherit" }
  );

  const keychain = path.join(
    process.env.HOME || "",
    "Library/Keychains/login.keychain-db"
  );

  try {
    // Remove previous broken import with same name if present.
    execFileSync(
      "security",
      ["delete-certificate", "-c", IDENTITY, keychain],
      { stdio: "pipe" }
    );
  } catch {
    /* none to delete */
  }

  execFileSync(
    "security",
    [
      "import",
      P12_PATH,
      "-k",
      keychain,
      "-P",
      P12_PASS,
      "-T",
      "/usr/bin/codesign",
      "-T",
      "/usr/bin/security",
      "-T",
      "/usr/bin/productbuild",
    ],
    { stdio: "inherit" }
  );

  try {
    execFileSync(
      "security",
      [
        "set-key-partition-list",
        "-S",
        "apple-tool:,apple:,codesign:",
        "-s",
        "-k",
        "",
        keychain,
      ],
      { stdio: "pipe" }
    );
  } catch {
    /* may need keychain unlock — codesign can still work interactively */
  }

  if (!hasIdentity()) {
    console.warn(
      `[codesign] identity "${IDENTITY}" not found after import — falling back to ad-hoc`
    );
    return null;
  }
  console.log(`[codesign] installed identity "${IDENTITY}"`);
  return IDENTITY;
}

module.exports = { IDENTITY, ensureIdentity };

if (require.main === module) {
  ensureIdentity();
}
