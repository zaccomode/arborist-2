#!/usr/bin/env node

// src/main.ts
import { spawnSync } from "node:child_process";

// src/cli.ts
import { parseArgs } from "node:util";

// ../packages/core/src/buckets.ts
var BUCKET_SEGMENT_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
var MAX_BUCKET_DEPTH = 8;
function isBucketPath(path) {
  const segments = path.split("/");
  return segments.length <= MAX_BUCKET_DEPTH && segments.every((segment) => BUCKET_SEGMENT_PATTERN.test(segment));
}

// ../packages/core/src/image-types.ts
var IMAGE_TYPES = {
  png: { contentType: "image/png" },
  jpg: { contentType: "image/jpeg" },
  gif: { contentType: "image/gif" },
  webp: { contentType: "image/webp" }
};
var IMAGE_EXTS = Object.keys(IMAGE_TYPES);
var MAX_IMAGE_BYTES = 10 * 1024 * 1024;
var CAMO_WARN_BYTES = 5 * 1024 * 1024;
function startsWith(bytes, signature, offset = 0) {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, i) => bytes[offset + i] === byte);
}
var PNG = [137, 80, 78, 71, 13, 10, 26, 10];
var JPEG = [255, 216, 255];
var GIF87A = [71, 73, 70, 56, 55, 97];
var GIF89A = [71, 73, 70, 56, 57, 97];
var RIFF = [82, 73, 70, 70];
var WEBP = [87, 69, 66, 80];
function detectImageType(bytes) {
  if (startsWith(bytes, PNG)) return "png";
  if (startsWith(bytes, JPEG)) return "jpg";
  if (startsWith(bytes, GIF87A) || startsWith(bytes, GIF89A)) return "gif";
  if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8)) return "webp";
  return null;
}
function contentTypeFor(ext) {
  return IMAGE_TYPES[ext].contentType;
}

// ../packages/core/src/urls.ts
var APP_HOST = "media.isaacshea.com";
var SHA256_PATTERN = /^[0-9a-f]{64}$/;
function isSha256(value) {
  return SHA256_PATTERN.test(value);
}
var IMAGE_PATH = new RegExp(`^/i/([0-9a-f]{64})\\.(${IMAGE_EXTS.join("|")})$`);
function parseImagePath(pathname) {
  const match = IMAGE_PATH.exec(pathname);
  if (!match) return null;
  return { sha256: match[1], ext: match[2] };
}
function sha256FromRef(ref) {
  const trimmed = ref.trim().toLowerCase();
  if (isSha256(trimmed)) return trimmed;
  try {
    return parseImagePath(new URL(trimmed).pathname)?.sha256 ?? null;
  } catch {
    return null;
  }
}

// src/api.ts
var ApiError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
  status;
};
var Api = class {
  constructor(io) {
    this.io = io;
    this.origin = (io.env.CDN_API || `https://${APP_HOST}`).replace(/\/+$/, "");
    this.token = io.env.CDN_TOKEN || void 0;
  }
  io;
  origin;
  token;
  async request(method, path, options = {}) {
    const url = new URL(`/api${path}`, this.origin);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== void 0 && value !== false) url.searchParams.set(key, String(value));
    }
    const headers = { ...options.headers };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    let body;
    if (options.json !== void 0) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.json);
    } else if (options.body) {
      headers["Content-Length"] = `${options.body.length}`;
      body = options.body;
    }
    let res;
    try {
      res = await this.io.fetch(url, { method, headers, body });
    } catch (error) {
      const cause = error.cause;
      const code = typeof cause?.code === "string" && cause.code ? cause.code : null;
      const reason = code ?? cause?.message ?? error.message;
      throw new ApiError(0, `Can't reach ${this.origin}: ${reason}`);
    }
    const text = await res.text();
    const data = text ? safeJson(text) : void 0;
    if (!res.ok) {
      let message = data?.error ?? `HTTP ${res.status}`;
      if (res.status === 401 && !this.token) {
        message += ". Set CDN_TOKEN, or in a Claude cloud session save the token as a network secret for this host.";
      }
      throw new ApiError(res.status, message);
    }
    return data;
  }
};
function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return void 0;
  }
}

// src/files.ts
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
var FileError = class extends Error {
};
async function loadImage(path) {
  let bytes;
  try {
    bytes = new Uint8Array(await readFile(path));
  } catch (error) {
    throw new FileError(
      `${path}: ${error.code === "ENOENT" ? "no such file" : error.message}`
    );
  }
  const ext = detectImageType(bytes);
  if (!ext) throw new FileError(`${path}: not a PNG, JPEG, GIF or WebP image`);
  if (bytes.length > MAX_IMAGE_BYTES) throw new FileError(`${path}: over the 10 MB limit`);
  return {
    path,
    filename: basename(path),
    bytes,
    ext,
    contentType: contentTypeFor(ext),
    sha256: createHash("sha256").update(bytes).digest("hex")
  };
}
async function resolveHash(ref) {
  return sha256FromRef(ref) ?? (await loadImage(ref)).sha256;
}

// src/commands/read.ts
async function missing(api, io, refs) {
  const entries = await Promise.all(
    refs.map(
      async (ref) => isSha256(ref) ? { ref, hash: ref } : { ref, hash: (await loadImage(ref)).sha256 }
    )
  );
  const res = await api.request("POST", "/images/missing", {
    json: { hashes: [...new Set(entries.map((entry) => entry.hash))] }
  });
  const absent = new Set(res.missing);
  for (const entry of entries) {
    if (!absent.has(entry.hash)) continue;
    io.stdout(entry.ref === entry.hash ? `${entry.hash}
` : `${entry.hash}  ${entry.ref}
`);
  }
  return 0;
}
async function get(api, io, ref, json) {
  const image = await api.request("GET", `/images/${await resolveHash(ref)}`);
  if (json) {
    io.stdout(`${JSON.stringify(image, null, 2)}
`);
    return 0;
  }
  const dims = image.width && image.height ? `, ${image.width}\xD7${image.height}` : "";
  const lines = [
    `url       ${image.url}`,
    `markdown  ${image.markdown}`,
    `size      ${formatBytes(image.bytes)}${dims}, ${image.content_type}`,
    "buckets",
    ...image.buckets.map((b) => {
      const extra = [
        b.alt && `alt "${b.alt}"`,
        b.tags.length && `tags ${b.tags.join(", ")}`
      ].filter(Boolean);
      return `  ${b.path}${extra.length ? `  ${extra.join("; ")}` : ""}`;
    })
  ];
  if (image.uploads.length) {
    lines.push("uploads");
    for (const u of image.uploads) {
      const source = u.repo ? `${u.repo}${u.pr ? `#${u.pr}` : ""}` : "";
      lines.push(
        `  ${u.created_at.slice(0, 16).replace("T", " ")}  ${[u.bucket, u.filename, source, u.note].filter(Boolean).join("  ")}`
      );
    }
  }
  io.stdout(`${lines.join("\n")}
`);
  return 0;
}
async function list(api, io, options) {
  const images = [];
  let cursor;
  while (images.length < options.limit) {
    const page = await api.request("GET", "/images", {
      query: {
        bucket: options.bucket,
        recursive: options.recursive,
        repo: options.repo,
        tag: options.tag,
        since: options.since,
        q: options.search,
        cursor,
        limit: Math.min(200, options.limit - images.length)
      }
    });
    images.push(...page.images.slice(0, options.limit - images.length));
    if (!page.next_cursor) break;
    cursor = page.next_cursor;
  }
  if (options.json) {
    io.stdout(`${JSON.stringify(images, null, 2)}
`);
    return 0;
  }
  for (const image of images) {
    const where = image.buckets.map((b) => b.path).join(", ");
    io.stdout(`${image.added_at.slice(0, 10)}  ${image.url}  ${where}
`);
  }
  return 0;
}
async function buckets(api, io, json) {
  const res = await api.request("GET", "/buckets");
  if (json) {
    io.stdout(`${JSON.stringify(res.buckets, null, 2)}
`);
    return 0;
  }
  const width = Math.max(0, ...res.buckets.map((b) => b.path.length));
  for (const b of res.buckets) {
    io.stdout(
      `${b.path.padEnd(width)}  ${b.scopes.join("+")}  ${b.image_count} image${b.image_count === 1 ? "" : "s"}
`
    );
  }
  return 0;
}
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// src/commands/upload.ts
var CONCURRENCY = 4;
async function upload(api, io, paths, options) {
  const files = await Promise.all(paths.map(loadImage));
  const hashes = [...new Set(files.map((file) => file.sha256))];
  const missing2 = /* @__PURE__ */ new Set();
  for (let i = 0; i < hashes.length; i += 1e3) {
    const res = await api.request("POST", "/images/missing", {
      json: { hashes: hashes.slice(i, i + 1e3) }
    });
    for (const hash of res.missing) missing2.add(hash);
  }
  const unique = [...new Map(files.map((file) => [file.sha256, file])).values()];
  const results = /* @__PURE__ */ new Map();
  let next = 0;
  const worker = async () => {
    while (next < unique.length) {
      const file = unique[next++];
      try {
        results.set(file.sha256, await send(api, file, options, missing2.has(file.sha256)));
      } catch (error) {
        results.set(file.sha256, error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, unique.length) }, worker));
  let failed = 0;
  const output = [];
  for (const file of files) {
    const result = results.get(file.sha256);
    if (result instanceof Error) {
      failed++;
      io.stderr(`${file.path}: ${result.message}
`);
      continue;
    }
    if (result.warning) io.stderr(`${file.path}: ${result.warning}
`);
    output.push({ file: file.path, ...result });
  }
  if (options.json) io.stdout(`${JSON.stringify(output, null, 2)}
`);
  else for (const result of output) io.stdout(`${result.markdown}
`);
  return failed ? 1 : 0;
}
async function send(api, file, options, withBytes) {
  const query = {
    bucket: options.bucket,
    create: options.create,
    filename: file.filename,
    repo: options.repo,
    pr: options.pr,
    note: options.note
  };
  const put = (bytes) => api.request("PUT", `/images/${file.sha256}`, {
    query,
    ...bytes ? { body: file.bytes, headers: { "Content-Type": file.contentType } } : { body: new Uint8Array() }
  });
  if (withBytes) return put(true);
  try {
    return await put(false);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404 && error.message.startsWith("Image not stored")) {
      return put(true);
    }
    throw error;
  }
}

// src/io.ts
var UsageError = class extends Error {
};

// src/commands/write.ts
async function createBucket(api, io, path) {
  const bucket = await api.request("POST", "/buckets", { json: { path } });
  io.stdout(`Created ${bucket.path}
`);
  return 0;
}
async function edit(api, io, ref, options) {
  if (options.alt === void 0 && options.tags === void 0) {
    throw new UsageError("Nothing to change: pass --alt, --tag or --clear-tags");
  }
  const res = await api.request(
    "PATCH",
    `/images/${await resolveHash(ref)}`,
    { query: { bucket: options.bucket }, json: { alt: options.alt, tags: options.tags } }
  );
  io.stdout(
    `${res.bucket}: alt "${res.alt}"${res.tags.length ? `, tags ${res.tags.join(", ")}` : ""}
`
  );
  return 0;
}
async function remove(api, io, ref, options) {
  if (!options.yes) {
    throw new UsageError(
      "Removing an image deletes it, and breaks its URL, if no other bucket holds it. Pass --yes to go ahead"
    );
  }
  const res = await api.request(
    "DELETE",
    `/images/${await resolveHash(ref)}`,
    {
      query: { bucket: options.bucket }
    }
  );
  io.stdout(
    res.deleted ? `Removed from ${options.bucket}. No other bucket held it, so it's deleted and its URL now 404s.
` : `Removed from ${options.bucket}. Other buckets still hold it, so its URL still works.
`
  );
  return 0;
}

// src/cli.ts
var VERSION = "0.1.0";
var USAGE = `Usage: cdn <command> [options]

Commands:
  upload <files...>   Upload images to a bucket and print their markdown
                        --bucket <path>  --create  --repo owner/name
                        --pr <number>  --note <text>  --json
  missing <files or hashes...>
                      Print the hashes that aren't stored yet
  get <sha256, url or file>
                      Print an image's metadata, its buckets and its uploads
  list                List images, newest first
                        --bucket <path>  --recursive  --repo owner/name
                        --tag <tag>  --since <date>  --search <text>
                        --limit <n>  --json
  buckets             List the buckets this token reaches
  buckets create <path>
                      Create a bucket inside one this token is granted
  edit <sha256, url or file> --bucket <path>
                      Change alt text or tags in that bucket
                        --alt <text>  --tag <tag> (repeatable)  --clear-tags
  remove <sha256, url or file> --bucket <path> --yes
                      Remove an image from a bucket; deleted if no other
                      bucket holds it. Needs a token with the delete scope.

Options:
  -h, --help          Show this help
  -v, --version       Show the version

Environment:
  CDN_TOKEN           Bearer token. Leave unset in Claude cloud sessions, where
                      the egress proxy adds it.
  CDN_BUCKET          Default for --bucket, e.g. arborist-2/screenshots
  CDN_API             API origin (default https://${APP_HOST})
`;
function parsed(parse) {
  try {
    return parse();
  } catch (error) {
    throw new UsageError(error.message);
  }
}
function bucketFrom(value, io, required = true) {
  const bucket = value ?? io.env.CDN_BUCKET;
  if (!bucket) {
    if (required) throw new UsageError("Pass --bucket, or set CDN_BUCKET");
    return void 0;
  }
  if (!isBucketPath(bucket)) {
    throw new UsageError(
      `"${bucket}" isn't a bucket path: lowercase segments like arborist-2/screenshots`
    );
  }
  return bucket;
}
function one(positionals, what) {
  if (positionals.length !== 1) throw new UsageError(`Expected one ${what}`);
  return positionals[0];
}
async function run(argv, io) {
  const [command, ...rest] = argv;
  if (command === void 0 || command === "-h" || command === "--help" || command === "help") {
    io.stdout(USAGE);
    return 0;
  }
  if (command === "-v" || command === "--version") {
    io.stdout(`${VERSION}
`);
    return 0;
  }
  if (rest.includes("--help") || rest.includes("-h")) {
    io.stdout(USAGE);
    return 0;
  }
  const api = new Api(io);
  try {
    switch (command) {
      case "upload": {
        const { values, positionals } = parsed(
          () => parseArgs({
            args: rest,
            allowPositionals: true,
            options: {
              bucket: { type: "string" },
              create: { type: "boolean" },
              repo: { type: "string" },
              pr: { type: "string" },
              note: { type: "string" },
              json: { type: "boolean" }
            }
          })
        );
        if (positionals.length === 0) throw new UsageError("Name at least one file to upload");
        const pr = values.pr === void 0 ? void 0 : Number(values.pr);
        if (pr !== void 0 && !(Number.isInteger(pr) && pr > 0))
          throw new UsageError("--pr takes a number");
        return await upload(api, io, positionals, {
          bucket: bucketFrom(values.bucket, io),
          create: Boolean(values.create),
          repo: values.repo,
          pr,
          note: values.note,
          json: Boolean(values.json)
        });
      }
      case "missing": {
        const { positionals } = parsed(
          () => parseArgs({ args: rest, allowPositionals: true, options: {} })
        );
        if (positionals.length === 0) throw new UsageError("Name at least one file or hash");
        return await missing(api, io, positionals);
      }
      case "get": {
        const { values, positionals } = parsed(
          () => parseArgs({ args: rest, allowPositionals: true, options: { json: { type: "boolean" } } })
        );
        return await get(api, io, one(positionals, "hash, URL or file"), Boolean(values.json));
      }
      case "list": {
        const { values } = parsed(
          () => parseArgs({
            args: rest,
            allowPositionals: true,
            options: {
              bucket: { type: "string" },
              recursive: { type: "boolean" },
              repo: { type: "string" },
              tag: { type: "string" },
              since: { type: "string" },
              search: { type: "string" },
              limit: { type: "string" },
              json: { type: "boolean" }
            }
          })
        );
        const limit = values.limit === void 0 ? 50 : Number(values.limit);
        if (!(Number.isInteger(limit) && limit > 0)) throw new UsageError("--limit takes a number");
        return await list(api, io, {
          bucket: bucketFrom(values.bucket, io, false),
          recursive: Boolean(values.recursive),
          repo: values.repo,
          tag: values.tag,
          since: values.since,
          search: values.search,
          limit,
          json: Boolean(values.json)
        });
      }
      case "buckets": {
        const { values, positionals } = parsed(
          () => parseArgs({ args: rest, allowPositionals: true, options: { json: { type: "boolean" } } })
        );
        if (positionals[0] === "create") {
          const path = one(positionals.slice(1), "bucket path");
          return await createBucket(api, io, bucketFrom(path, io));
        }
        if (positionals.length) throw new UsageError(`Unknown buckets command "${positionals[0]}"`);
        return await buckets(api, io, Boolean(values.json));
      }
      case "edit": {
        const { values, positionals } = parsed(
          () => parseArgs({
            args: rest,
            allowPositionals: true,
            options: {
              bucket: { type: "string" },
              alt: { type: "string" },
              tag: { type: "string", multiple: true },
              "clear-tags": { type: "boolean" }
            }
          })
        );
        const tags = values["clear-tags"] ? [] : values.tag;
        return await edit(api, io, one(positionals, "hash, URL or file"), {
          bucket: bucketFrom(values.bucket, io),
          alt: values.alt,
          tags
        });
      }
      case "remove": {
        const { values, positionals } = parsed(
          () => parseArgs({
            args: rest,
            allowPositionals: true,
            options: {
              bucket: { type: "string" },
              yes: { type: "boolean" }
            }
          })
        );
        return await remove(api, io, one(positionals, "hash, URL or file"), {
          bucket: bucketFrom(values.bucket, io),
          yes: Boolean(values.yes)
        });
      }
      default:
        io.stderr(`cdn: unknown command "${command}"

${USAGE}`);
        return 2;
    }
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(`cdn ${command}: ${error.message}
Run "cdn --help" for usage.
`);
      return 2;
    }
    if (error instanceof ApiError || error instanceof FileError) {
      io.stderr(`cdn ${command}: ${error.message}
`);
      return 1;
    }
    throw error;
  }
}

// src/proxy.ts
function proxyRelaunch(env, execArgv, argv) {
  const proxy = env.HTTPS_PROXY || env.https_proxy;
  if (!proxy || env.NODE_USE_ENV_PROXY) return null;
  const [, script, ...rest] = argv;
  if (!script) return null;
  return {
    // Node warns that its proxy agent is experimental on every run.
    args: ["--disable-warning=UNDICI-EHPA", ...execArgv, script, ...rest],
    env: { ...env, NODE_USE_ENV_PROXY: "1" }
  };
}

// src/main.ts
var relaunch = proxyRelaunch(process.env, process.execArgv, process.argv);
if (relaunch) {
  const child = spawnSync(process.execPath, relaunch.args, { stdio: "inherit", env: relaunch.env });
  if (child.error) throw child.error;
  process.exit(child.status ?? 1);
}
process.exitCode = await run(process.argv.slice(2), {
  env: process.env,
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  fetch: (url, init) => fetch(url, init)
});
