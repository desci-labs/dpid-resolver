import { afterAll, beforeAll, describe, it, vi } from "vitest";
import { createRequire } from "module";
import assert from "assert";
import { app } from "../src/index.js";
import { getNodesUrl } from "../src/util/config.js";

// Use createRequire to import CommonJS supertest in ESM environment
const require = createRequire(import.meta.url);
const supertest = require("supertest");

// Simple interface for supertest response
interface TestResponse {
    header: Record<string, string>;
    status: number;
    [key: string]: unknown;
}

// Use the actual environment-based URL
const NODES_URL = getNodesUrl();
const IPFS_URL = "https://ipfs.desci.com/ipfs";

describe("dPID resolution", { timeout: 5_000 }, function () {
    beforeAll(() => {
        vi.stubEnv("FALLBACK_RESOLVER", "0");
        vi.stubEnv("DPID_ENV", "staging");
    });

    afterAll(() => {
        vi.unstubAllEnvs();
    });

    describe("web resolution (for humans)", async () => {
        it("should handle a plain dpid", async () => {
            await supertest(app)
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
            await supertest(app)
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
            await supertest(app)
                .get("/46/v4")
                .expect(302)
                .then((res: TestResponse) => {
                    const value = res.header["location"];

                    const expected = `${NODES_URL}/dpid/46/v4`;
                    assert.equal(value, expected, "incorrect resolution");
                })
                .catch((err: Error) => {
                    if (err) {
                        assert.fail(err);
                    }
                });
        });

        it("should handle a 0-indexed versioned dpid", async () => {
            await supertest(app)
                .get("/46/0")
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

        it("should handle a higher 0-indexed versioned dpid", async () => {
            await supertest(app)
                .get("/46/2")
                .expect(302)
                .then((res: TestResponse) => {
                    const value = res.header["location"];

                    const expected = `${NODES_URL}/dpid/46/v3`;
                    assert.equal(value, expected, "incorrect resolution");
                })
                .catch((err: Error) => {
                    if (err) {
                        assert.fail(err);
                    }
                });
        });

        it("should handle a generic attestations route", async () => {
            await supertest(app)
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
            await supertest(app)
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
            await supertest(app)
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
            await supertest(app)
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
            await supertest(app)
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
            await supertest(app)
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
            await supertest(app)
                .get("/46/v1?raw")
                .expect(302)
                .then((res: TestResponse) => {
                    const value = res.header["location"];

                    const expected = `${IPFS_URL}/bafkreia2nvcwknooiu6t6ywob4dhd6exb3aamogse4n7kkydybjaugdr6u`;
                    assert.equal(value, expected, "incorrect resolution");
                })
                .catch((err: Error) => {
                    if (err) {
                        assert.fail(err);
                    }
                });
        });

        // skipping due to bad migration on sepolia-dev
        it("should handle an unversioned raw dpid", async () => {
            await supertest(app)
                .get("/46?raw")
                .expect(302)
                .then((res: TestResponse) => {
                    const value = res.header["location"];

                    const expected = `${IPFS_URL}/bafkreihge5qw7sc3mqc4wkf4cgpv6udtvrgipfxwyph7dhlyu6bkkt7tfq`;
                    assert.equal(value, expected, "incorrect resolution");
                })
                .catch((err: Error) => {
                    if (err) {
                        assert.fail(err);
                    }
                });
        });

        it("should handle a dPID path", async () => {
            await supertest(app).get("/46/v4/root?raw").expect(200);
        });

        it("should handle a dPID path subfolder", async () => {
            await supertest(app).get("/46/v4/root/exploring-lupus?raw").expect(200);
        });

        it("should handle a dPID path to file", async () => {
            await supertest(app)
                .get("/46/v1/root/.nodeKeep?raw")
                .expect(302)
                .then((res: TestResponse) => {
                    const value = res.header["location"];

                    const expected = `${IPFS_URL}/bafybeieo5thng4grq5aujudqtagximd2k5ucs6ale6pxoecr64pqnrxuhe/.nodeKeep`;
                    assert.equal(value, expected, "incorrect resolution");
                })
                .catch((err: Error) => {
                    if (err) {
                        assert.fail(err);
                    }
                });
        });
    });
});
