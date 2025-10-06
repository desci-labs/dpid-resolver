import { describe, it } from "vitest";
import { createRequire } from "module";
import assert from "assert";
import { app } from "../../src/index.js";

// Use createRequire to import CommonJS supertest in ESM environment
const require = createRequire(import.meta.url);
const request = require("supertest");

// Simple interface for supertest response
interface TestResponse {
    header: Record<string, string>;
    status: number;
    body: unknown;
    [key: string]: unknown;
}

const NODES_URL = "https://nodes-dev.desci.com";
const IPFS_URL = "https://ipfs.desci.com/ipfs";

describe("generic resolver", { timeout: 10_000 }, function () {
    describe("web resolution (for humans)", () => {
        it("should handle a plain dpid", async () => {
            await request(app)
                .get("/46")
                .expect(302)
                .then((res: TestResponse) => {
                    const value = res.header["location"];

                    const expected = `${NODES_URL}/dpid/46`;
                    assert.equal(value, expected, "incorrect resolution");
                })
                .catch((err: Error) => {
                    if (err) {
                        assert.fail(err);
                    }
                });
        });

        it("should handle a versioned dpid", async () => {
            await request(app)
                .get("/46/v1")
                .expect(302)
                .then((res: TestResponse) => {
                    const value = res.header["location"];

                    const expected = `${NODES_URL}/dpid/46/v1`;

                    assert.equal(value, expected, "incorrect resolution");
                })
                .catch((err: Error) => {
                    if (err) {
                        assert.fail(err);
                    }
                });
        });

        it("should handle a higher versioned dpid", async () => {
            await request(app)
                .get("/46/v4")
                .expect(302)
                .then((res: TestResponse) => {
                    const value = res.header["location"];

                    const expected = `${NODES_URL}/dpid/46/v4`;
                    assert.equal(value, expected, "incorrect resolution");
                });
        });

        it("should handle a 0-indexed versioned dpid", async () => {
            await request(app)
                .get("/46/0")
                .expect(302)
                .then((res: TestResponse) => {
                    const value = res.header["location"];

                    const expected = `${NODES_URL}/dpid/46/v1`;
                    assert.equal(value, expected, "incorrect resolution");
                });
        });

        it("should handle a higher 0-indexed versioned dpid", async () => {
            await request(app)
                .get("/46/2")
                .expect(302)
                .then((res: TestResponse) => {
                    const value = res.header["location"];

                    const expected = `${NODES_URL}/dpid/46/v3`;
                    assert.equal(value, expected, "incorrect resolution");
                });
        });

        it("should handle a file path", async () => {
            await request(app)
                .get("/46/v4/root/exploring-lupus-report.pdf")
                .expect(302)
                .then((res: TestResponse) => {
                    const value = res.header["location"];

                    const expected = `${NODES_URL}/dpid/46/v4/root/exploring-lupus-report.pdf`;
                    assert.equal(value, expected, "incorrect resolution");
                });
        });

        it("should handle directory path", async () => {
            await request(app)
                .get("/46/v4/root/exploring-lupus")
                .expect(302)
                .then((res: TestResponse) => {
                    const value = res.header["location"];

                    const expected = `${NODES_URL}/dpid/46/v4/root/exploring-lupus`;
                    assert.equal(value, expected, "incorrect resolution");
                });
        });
        it("should handle a generic attestations route", async () => {
            await request(app)
                .get("/46/attestations")
                .expect(302)
                .then((res: TestResponse) => {
                    const value = res.header["location"];

                    const expected = `${NODES_URL}/dpid/46/attestations`;
                    assert.equal(value, expected, "incorrect resolution");
                })
                .catch((err: Error) => {
                    if (err) {
                        assert.fail(err);
                    }
                });
        });

        it("should handle a versioned(V) generic attestations route", async () => {
            await request(app)
                .get("/46/v2/attestations")
                .expect(302)
                .then((res: TestResponse) => {
                    const value = res.header["location"];

                    const expected = `${NODES_URL}/dpid/46/v2/attestations`;
                    assert.equal(value, expected, "incorrect resolution");
                })
                .catch((err: Error) => {
                    if (err) {
                        assert.fail(err);
                    }
                });
        });

        it("should handle a versioned(I) generic attestations route", async () => {
            await request(app)
                .get("/46/2/attestations")
                .expect(302)
                .then((res: TestResponse) => {
                    const value = res.header["location"];

                    const expected = `${NODES_URL}/dpid/46/v3/attestations`;
                    assert.equal(value, expected, "incorrect resolution");
                })
                .catch((err: Error) => {
                    if (err) {
                        assert.fail(err);
                    }
                });
        });

        it("should handle a specific attestations route with an attestation slug", async () => {
            await request(app)
                .get("/46/attestations/scientific-manuscript")
                .expect(302)
                .then((res: TestResponse) => {
                    const value = res.header["location"];

                    const expected = `${NODES_URL}/dpid/46/attestations/scientific-manuscript`;
                    assert.equal(value, expected, "incorrect resolution");
                })
                .catch((err: Error) => {
                    if (err) {
                        assert.fail(err);
                    }
                });
        });

        it("should handle a versioned(V) attestations route with an attestation slug", async () => {
            await request(app)
                .get("/46/v2/attestations/scientific-manuscript")
                .expect(302)
                .then((res: TestResponse) => {
                    const value = res.header["location"];

                    const expected = `${NODES_URL}/dpid/46/v2/attestations/scientific-manuscript`;
                    assert.equal(value, expected, "incorrect resolution");
                })
                .catch((err: Error) => {
                    if (err) {
                        assert.fail(err);
                    }
                });
        });

        it("should handle a versioned(I) attestations route with an attestation slug", async () => {
            await request(app)
                .get("/46/2/attestations/scientific-manuscript")
                .expect(302)
                .then((res: TestResponse) => {
                    const value = res.header["location"];

                    const expected = `${NODES_URL}/dpid/46/v3/attestations/scientific-manuscript`;
                    assert.equal(value, expected, "incorrect resolution");
                })
                .catch((err: Error) => {
                    if (err) {
                        assert.fail(err);
                    }
                });
        });
    });
    describe("raw resolution (for machines)", () => {
        // skipping because dev has duplicates, solve by reindexing dev sepolia graph
        it("should handle a versioned raw dpid", async () => {
            await request(app)
                .get("/46/v1?raw")
                .expect(302)
                .then((res: TestResponse) => {
                    const value = res.header["location"];

                    const expected = `${IPFS_URL}/bafkreia2nvcwknooiu6t6ywob4dhd6exb3aamogse4n7kkydybjaugdr6u`;
                    assert.equal(value, expected, "incorrect resolution");
                });
        });

        // skipping due to bad migration on sepolia-dev
        it("should handle an unversioned raw dpid", async () => {
            await request(app)
                .get("/46?raw")
                .expect(302)
                .then((res: TestResponse) => {
                    const value = res.header["location"];

                    const expected = `${IPFS_URL}/bafkreihge5qw7sc3mqc4wkf4cgpv6udtvrgipfxwyph7dhlyu6bkkt7tfq`;
                    assert.equal(value, expected, "incorrect resolution");
                });
        });

        it("should handle a dPID path", async () => {
            await request(app).get("/46/v1/root?raw").expect(200);
        });

        it("should handle a dPID path subfolder", async () => {
            await request(app).get("/46/v1/root/exploring-lupus?raw").expect(200);
        });

        it("should handle a dPID path to file", async () => {
            await request(app)
                .get("/46/v1/root/.nodeKeep?raw")
                .expect(302)
                .then((res: TestResponse) => {
                    const value = res.header["location"];

                    const expected = `${IPFS_URL}/bafybeieo5thng4grq5aujudqtagximd2k5ucs6ale6pxoecr64pqnrxuhe/.nodeKeep`;
                    assert.equal(value, expected, "incorrect resolution");
                });
        });
    });
});
