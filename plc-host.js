import { EcdsaKeypair } from "@atproto/crypto";
import { Client } from "@did-plc/lib";
import * as uint8arrays from "uint8arrays";
import * as CBOR from "https://esm.sh/cborg@^1.10.0";

const didString = {
  decode(text) {
    if (!text.startsWith("did:plc:")) {
      throw new TypeError("not a plc did");
    }
    return uint8arrays.fromString(text.slice("did:plc:".length), "base32");
  },
  encode(buf) {
    return "did:plc:" + uint8arrays.toString(buf, "base32");
  },
};

async function toDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

const url = "https://plc.directory";
const client = new Client(url);
function* chunks(uint8Array) {
  const chunkSize = 5 * 1024; // 5 KiB
  let offset = 0;

  while (offset < uint8Array.byteLength) {
    const remainingBytes = uint8Array.byteLength - offset;
    const viewSize = Math.min(chunkSize, remainingBytes);
    const chunk = new Uint8Array(
      uint8Array.buffer,
      uint8Array.byteOffset + offset,
      viewSize
    );
    yield chunk;

    offset += viewSize;
  }
}
import pLimit from "p-limit";
import pRetry from "p-retry";
const limit = pLimit(5);
const retryOptions = { retries: 5 };
export async function uploadRaw(file) {
  const signingKey = await EcdsaKeypair.create();
  const recoveryKey = await EcdsaKeypair.create();
  const did = await pRetry(
    () =>
      limit(async () =>
        client.createDid({
          signingKey: signingKey.did(),
          rotationKeys: [recoveryKey.did()],
          handle: await toDataURL(file),
          pds: "https://uwu",
          signer: recoveryKey,
        })
      ),
    retryOptions
  );
  return didString.decode(did);
}
export async function downloadRaw(did) {
  return await pRetry(
    () =>
      limit(
        async () =>
          await (
            await fetch(
              (await client.getDocument(didString.encode(did))).alsoKnownAs
                .find((e) => e.startsWith("at://data:"))
                .slice("at://".length)
            )
          ).blob()
      ),
    retryOptions
  );
}
async function uploadInternal(data) {
  const chunkIterator = chunks(
    CBOR.encode(
      data instanceof Array
        ? { c: data }
        : { t: data.type, d: await new Response(data).arrayBuffer() }
    )
  );
  let dids = await Promise.all([...chunkIterator].map(chunk=>uploadRaw(new Blob([chunk], { type: "x/c" }))));
  if (dids.length > 1) {
    dids = await uploadInternal(dids);
  }
  return dids;
}
async function downloadInternal(arr) {
  const chunks = await Promise.all(arr.map(downloadRaw));
  const data = CBOR.decode(
    new Uint8Array(
      await new Response(
        new Blob(chunks, { type: chunks[0].type })
      ).arrayBuffer()
    )
  );
  if (!data || typeof data !== "object")
    throw new Error("data wasn't an object");
  if (data.d instanceof Uint8Array) {
    return new Blob([data.d], { type: data.t });
  } else if (data.c instanceof Array) {
    console.log("recursing (data/list too big for one chunk)");
    return downloadInternal(data.c);
  } else {
    throw new Error("unrecognized data type");
  }
}
export async function upload(data) {
  return didString.encode((await uploadInternal(data))[0]);
}
export async function download(did) {
  return await downloadInternal([didString.decode(did)]);
}
console.log("we get a little silly with it");
