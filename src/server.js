const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const port = Number(process.env.PORT) || 3000;
const publicDirectory = path.join(__dirname, "public");
const files = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
]);

const server = http.createServer((request, response) => {
  const requestedFile = files.get(new URL(request.url, `http://${request.headers.host}`).pathname);

  if (request.method !== "GET" || !requestedFile) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  const [fileName, contentType] = requestedFile;
  fs.readFile(path.join(publicDirectory, fileName), (error, content) => {
    if (error) {
      console.error(`Unable to read ${fileName}:`, error);
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Unable to load the application.");
      return;
    }

    response.writeHead(200, {
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
    });
    response.end(content);
  });
});

server.listen(port, () => {
  console.log(`CSV Loader is running at http://localhost:${port}`);
});
