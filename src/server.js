const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const port = Number(process.env.PORT) || 3000;
const publicDirectory = path.join(__dirname, "dist", "public");
const databasePath = process.env.CLAIMS_DB_PATH || path.join(__dirname, "data", "claims.sqlite");
const maxRequestBytes = 10 * 1024 * 1024;
const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function getStaticCacheControl(filePath) {
  const fileName = path.basename(filePath);
  if (fileName === "index.html") return "no-cache";
  return /-[A-Z0-9_-]{8,}\.(?:js|css)$/i.test(fileName)
    ? "public, max-age=31536000, immutable"
    : "public, max-age=3600";
}

fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const database = new Database(databasePath);
database.pragma("journal_mode = WAL");
database.exec(`
  CREATE TABLE IF NOT EXISTS claims (
    id INTEGER PRIMARY KEY,
    claim_number TEXT NOT NULL UNIQUE,
    data TEXT NOT NULL,
    reviewed INTEGER NOT NULL DEFAULT 0,
    review_comment TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);

const claimColumns = new Set(database.pragma("table_info(claims)").map(({ name }) => name));
if (!claimColumns.has("reviewed")) {
  database.exec("ALTER TABLE claims ADD COLUMN reviewed INTEGER NOT NULL DEFAULT 0");
}
if (!claimColumns.has("review_comment")) {
  database.exec("ALTER TABLE claims ADD COLUMN review_comment TEXT NOT NULL DEFAULT ''");
}

const selectClaims = database.prepare(`
  SELECT claim_number, data, reviewed, review_comment
  FROM claims ORDER BY claim_number DESC
`);
const findClaim = database.prepare("SELECT data FROM claims WHERE claim_number = ?");
const findReview = database.prepare("SELECT reviewed, review_comment FROM claims WHERE claim_number = ?");
const insertClaim = database.prepare(`
  INSERT INTO claims (claim_number, data, created_at, updated_at)
  VALUES (?, ?, ?, ?)
`);
const updateClaim = database.prepare(`
  UPDATE claims SET data = ?, updated_at = ? WHERE claim_number = ?
`);
const updateReview = database.prepare(`
  UPDATE claims SET reviewed = ?, review_comment = ? WHERE claim_number = ?
`);

function getStoredClaims() {
  const rows = selectClaims.all();
  const claims = rows.map(({ data }) => JSON.parse(data));
  const headers = [];
  const seenHeaders = new Set();

  claims.forEach((claim) => {
    Object.keys(claim).forEach((header) => {
      if (!seenHeaders.has(header)) {
        seenHeaders.add(header);
        headers.push(header);
      }
    });
  });

  return {
    headers,
    records: claims.map((claim) => headers.map((header) => claim[header] ?? "")),
    reviews: Object.fromEntries(rows.map(({ claim_number, reviewed, review_comment }) => [
      claim_number,
      { reviewed: Boolean(reviewed), comment: review_comment },
    ])),
  };
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    let receivedBytes = 0;
    let settled = false;

    request.on("data", (chunk) => {
      if (settled) return;

      body += chunk;
      receivedBytes += chunk.length;
      if (receivedBytes > maxRequestBytes) {
        settled = true;
        reject(Object.assign(new Error("The request body is too large."), { statusCode: 413 }));
        request.resume();
      }
    });
    request.on("end", () => {
      if (settled) return;
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(Object.assign(new Error("The request body must be valid JSON."), { statusCode: 400 }));
      }
    });
    request.on("error", (error) => {
      if (!settled) reject(error);
    });
  });
}

function validateImport(payload) {
  if (!payload || !Array.isArray(payload.headers) || !Array.isArray(payload.records)) {
    throw Object.assign(new Error("The import must include CSV headers and records."), { statusCode: 400 });
  }

  const headers = payload.headers;
  if (
    headers.length === 0
    || headers.some((header) => typeof header !== "string")
    || !headers.includes("Claim Number")
  ) {
    throw Object.assign(new Error('The CSV must include a "Claim Number" column.'), { statusCode: 400 });
  }

  const claimNumberIndex = headers.indexOf("Claim Number");
  const claimsByNumber = new Map();
  payload.records.forEach((values, index) => {
    if (!Array.isArray(values) || values.some((value) => typeof value !== "string")) {
      throw Object.assign(new Error(`CSV record ${index + 2} has invalid values.`), { statusCode: 400 });
    }

    const claimNumber = (values[claimNumberIndex] ?? "").trim();
    if (!claimNumber) {
      throw Object.assign(new Error(`CSV record ${index + 2} is missing a Claim Number.`), { statusCode: 400 });
    }

    const claim = Object.fromEntries(headers.map((header, column) => [header, values[column] ?? ""]));
    claimsByNumber.set(claimNumber, claim);
  });

  return claimsByNumber;
}

function stableJson(value) {
  return JSON.stringify(Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, value[key]]),
  ));
}

function importClaims(payload) {
  const claimsByNumber = validateImport(payload);
  const now = new Date().toISOString();
  const counts = { inserted: 0, updated: 0, unchanged: 0 };
  const saveClaims = database.transaction(() => {
    claimsByNumber.forEach((claim, claimNumber) => {
      const serializedClaim = JSON.stringify(claim);
      const existing = findClaim.get(claimNumber);
      if (!existing) {
        insertClaim.run(claimNumber, serializedClaim, now, now);
        counts.inserted += 1;
      } else if (stableJson(JSON.parse(existing.data)) !== stableJson(claim)) {
        updateClaim.run(serializedClaim, now, claimNumber);
        counts.updated += 1;
      } else {
        counts.unchanged += 1;
      }
    });
  });
  saveClaims();

  return { ...counts, ...getStoredClaims() };
}

function saveReview(payload) {
  if (
    !payload
    || typeof payload.claimNumber !== "string"
    || !payload.claimNumber.trim()
    || typeof payload.reviewed !== "boolean"
    || typeof payload.comment !== "string"
  ) {
    throw Object.assign(new Error("A claim number, reviewed status, and comment are required."), { statusCode: 400 });
  }
  if (payload.comment.length > 5000) {
    throw Object.assign(new Error("Review comments must be 5,000 characters or fewer."), { statusCode: 400 });
  }

  const claimNumber = payload.claimNumber.trim();
  if (!findReview.get(claimNumber)) {
    throw Object.assign(new Error("The claim was not found."), { statusCode: 404 });
  }

  updateReview.run(Number(payload.reviewed), payload.comment, claimNumber);
  return {
    claimNumber,
    reviewed: payload.reviewed,
    comment: payload.comment,
  };
}

function getErrorStatusCode(error) {
  return Number.isInteger(error.statusCode) ? error.statusCode : 500;
}

const server = http.createServer(async (request, response) => {
  const pathname = new URL(request.url, `http://${request.headers.host || "localhost"}`).pathname;

  if (pathname === "/api/claims" && request.method === "GET") {
    try {
      sendJson(response, 200, getStoredClaims());
    } catch (error) {
      console.error("Unable to read stored claims:", error);
      sendJson(response, 500, { error: "Unable to read claims from the database." });
    }
    return;
  }

  if (pathname === "/api/claims" && request.method === "POST") {
    try {
      sendJson(response, 200, importClaims(await readJsonBody(request)));
    } catch (error) {
      const statusCode = getErrorStatusCode(error);
      if (statusCode === 500) {
        console.error("Unable to import claims:", error);
      }
      sendJson(response, statusCode, {
        error: statusCode === 500 ? "Unable to save claims to the database." : error.message,
      });
    }
    return;
  }

  if (pathname === "/api/reviews" && request.method === "PUT") {
    try {
      sendJson(response, 200, saveReview(await readJsonBody(request)));
    } catch (error) {
      const statusCode = getErrorStatusCode(error);
      if (statusCode === 500) {
        console.error("Unable to save claim review:", error);
      }
      sendJson(response, statusCode, {
        error: statusCode === 500 ? "Unable to save the claim review." : error.message,
      });
    }
    return;
  }

  if (pathname === "/api" || pathname.startsWith("/api/")) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  if (request.method !== "GET") {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  let requestedPath;
  try {
    const relativePath = pathname === "/"
      ? "index.html"
      : pathname === "/favicon.ico"
        ? "favicon.svg"
        : decodeURIComponent(pathname).replace(/^\/+/, "");
    if (relativePath.includes("\0")) {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Invalid path");
      return;
    }
    requestedPath = path.resolve(publicDirectory, relativePath);
  } catch {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Invalid path");
    return;
  }

  if (
    requestedPath !== publicDirectory
    && !requestedPath.startsWith(`${publicDirectory}${path.sep}`)
  ) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  const serveFile = (filePath) => {
    fs.readFile(filePath, (error, content) => {
      if (error) {
        console.error(`Unable to read ${path.basename(filePath)}:`, error);
        response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Unable to load the application.");
        return;
      }

      response.writeHead(200, {
        "Content-Type": contentTypes.get(path.extname(filePath)) || "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": getStaticCacheControl(filePath),
      });
      response.end(content);
    });
  };

  fs.readFile(requestedPath, (error, content) => {
    if (error) {
      if (error.code === "ENOENT" && path.extname(requestedPath) === "") {
        serveFile(path.join(publicDirectory, "index.html"));
        return;
      }
      if (error.code === "ENOENT") {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
      }
      console.error(`Unable to read ${path.basename(requestedPath)}:`, error);
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Unable to load the application.");
      return;
    }

    response.writeHead(200, {
      "Content-Type": contentTypes.get(path.extname(requestedPath)) || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": getStaticCacheControl(requestedPath),
    });
    response.end(content);
  });
});

server.listen(port, () => {
  console.log(`Claims Helper is running at http://localhost:${port}`);
});
