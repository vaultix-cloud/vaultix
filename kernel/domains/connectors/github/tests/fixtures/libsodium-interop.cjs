// Used by tests/interop.rs. Reads {"module": path to libsodium-wrappers, "pub": b64, "sec": b64, "sealedByRust": b64} on stdin.
// Opens the box Rust sealed with libsodium, and seals a new message to a fresh keypair with libsodium, for Rust to open.
const chunks = [];
process.stdin.on("data", c => chunks.push(c));
process.stdin.on("end", async () => {
  const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const sodium = require(input.module);
  await sodium.ready;
  const b64 = sodium.base64_variants.ORIGINAL;
  const opened = sodium.crypto_box_seal_open(sodium.from_base64(input.sealedByRust, b64), sodium.from_base64(input.pub, b64), sodium.from_base64(input.sec, b64));
  const pair = sodium.crypto_box_keypair();
  const sealed = sodium.crypto_box_seal(sodium.from_string("sealed-by-libsodium"), pair.publicKey);
  process.stdout.write(JSON.stringify({
    openedByLibsodium: sodium.to_string(opened),
    pub2: sodium.to_base64(pair.publicKey, b64),
    sec2: sodium.to_base64(pair.privateKey, b64),
    sealedByLibsodium: sodium.to_base64(sealed, b64)
  }));
});
