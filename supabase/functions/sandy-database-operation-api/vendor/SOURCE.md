Pinned upstream: https://www.npmjs.com/package/libpg-query/v/18.1.5

Package tarball SHA256: `52367cfeeb0732877fb98a9743bf4681fe628f13f87df19d619cfb386e02bcf3`. WASM SHA256: `378b64e6182f65c71ad5dbd2c31c81e9dfed7d2f2debfb4b51c0d0de8fa2ae36`.

The upstream ESM wrapper/factory and WASM are preserved with three transport adaptations: embed WASM as a base64 TypeScript module, initialize it from memory with print callbacks disabled, and disable the Node filesystem branch/export the factory as ESM. No parser or scanner logic changed. This makes Edge bundling deterministic and tests need no filesystem/network permission.

libpg_query uses the PostgreSQL parser compiled to WASM; upstream MIT license is included. PostgreSQL license: https://www.postgresql.org/about/licence/.
