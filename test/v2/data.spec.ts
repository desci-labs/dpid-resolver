import { describe, it, expect } from "vitest";
import { createRequire } from "module";
import { app } from "../../src/index.js";
import type { TestResponse } from "../testUtils.js";

const require = createRequire(import.meta.url);
const request = require("supertest");

describe("/api/v2/data", { timeout: 60_000 }, () => {
    describe("GET /api/v2/data/cid/:cid", () => {
        it("should assign correct gateway to files", async () => {
            await request(app)
                .get("/api/v2/data/cid/bafybeihcxoylynlvflnziuw457yfquev7zb4kgmskcxv3vj6u4hfs3dfrq?depth=full")
                .expect(200)
                .expect((res: TestResponse) => {
                    expect(res.body).toMatchObject({
                        children: expect.arrayContaining([
                            expect.objectContaining({
                                path: "bafybeihcxoylynlvflnziuw457yfquev7zb4kgmskcxv3vj6u4hfs3dfrq/insight-journal-metadata.json",
                                size: 9095,
                                type: "file",
                                gateway: "https://ipfs.desci.com/api/v0",
                            }),
                            expect.objectContaining({
                                name: "manuscript.pdf",
                                path: "bafybeihcxoylynlvflnziuw457yfquev7zb4kgmskcxv3vj6u4hfs3dfrq/manuscript.pdf",
                                gateway: "https://pub.desci.com/api/v0",
                            }),
                            expect.objectContaining({
                                name: "code",
                                path: "bafybeihcxoylynlvflnziuw457yfquev7zb4kgmskcxv3vj6u4hfs3dfrq/code",
                                gateway: "https://ipfs.desci.com/api/v0",
                                children: expect.arrayContaining([
                                    expect.objectContaining({
                                        name: "itk-module.cmake",
                                        path: "bafybeihcxoylynlvflnziuw457yfquev7zb4kgmskcxv3vj6u4hfs3dfrq/code/itk-module.cmake",
                                        gateway: "https://pub.desci.com/api/v0",
                                    }),
                                ]),
                            }),
                        ]),
                    });
                });
        });
    });
});
