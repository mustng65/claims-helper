# Claims Helper Angular client

The client is a standalone Angular application using Angular Material. Its production build is written to `src/dist/public`, where the Node.js server serves the app and its `/api` endpoints.

## Local development

Start the API in one terminal:

```sh
cd src
npm start
```

Then start the Angular development server in another terminal:

```sh
cd client
npm ci
npm start
```

Open <http://localhost:4200>. The development server proxies `/api` requests to the Node.js server at `http://localhost:3000`.

## Production build

```sh
cd client
npm ci
npm run build
cd ../src
npm start
```

The Node.js server serves the built Angular application at <http://localhost:3000>. The root Docker build compiles the client and packages it with the API server.
