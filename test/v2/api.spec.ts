import { describe, expect, it } from "vitest";
import request from "supertest";
import assert from "assert";
import { app } from "../../src/index.js";
import type { getCodexHistory } from "../../src/api/v2/queries/history.js";

type ResearchObject = Awaited<ReturnType<typeof getCodexHistory>> & {
    license?: string;
};

const NODES_URL = "https://nodes-dev.desci.com";
const IPFS_URL = "https://ipfs.desci.com/ipfs";

describe("dPID", { timeout: 10_000 }, function () {
    describe("web resolution (for humans)", () => {
        it("should handle a plain dpid", async () => {
            await request(app)
                .get("/46")
                .expect(302)
                .then((res) => {
                    const value = res.header["location"];

                    const expected = `${NODES_URL}/dpid/46`;
                    assert.equal(value, expected, "incorrect resolution");
                })
                .catch((err) => {
                    if (err) {
                        assert.fail(err);
                    }
                });
        });

        it("should handle a versioned dpid", async () => {
            await request(app)
                .get("/46/v1")
                .expect(302)
                .then((res) => {
                    const value = res.header["location"];

                    const expected = `${NODES_URL}/dpid/46/v1`;

                    assert.equal(value, expected, "incorrect resolution");
                })
                .catch((err) => {
                    if (err) {
                        assert.fail(err);
                    }
                });
        });

        it("should handle a higher versioned dpid", async () => {
            await request(app)
                .get("/46/v4")
                .expect(302)
                .then((res) => {
                    const value = res.header["location"];

                    const expected = `${NODES_URL}/dpid/46/v4`;
                    assert.equal(value, expected, "incorrect resolution");
                });
        });

        it("should handle a 0-indexed versioned dpid", async () => {
            await request(app)
                .get("/46/0")
                .expect(302)
                .then((res) => {
                    const value = res.header["location"];

                    const expected = `${NODES_URL}/dpid/46/v1`;
                    assert.equal(value, expected, "incorrect resolution");
                });
        });

        it("should handle a higher 0-indexed versioned dpid", async () => {
            await request(app)
                .get("/46/2")
                .expect(302)
                .then((res) => {
                    const value = res.header["location"];

                    const expected = `${NODES_URL}/dpid/46/v3`;
                    assert.equal(value, expected, "incorrect resolution");
                });
        });

        it("should handle a file path", async () => {
            await request(app)
                .get("/46/v4/root/exploring-lupus-report.pdf")
                .expect(302)
                .then((res) => {
                    const value = res.header["location"];

                    const expected = `${NODES_URL}/dpid/46/v4/root/exploring-lupus-report.pdf`;
                    assert.equal(value, expected, "incorrect resolution");
                });
        });

        it("should handle directory path", async () => {
            await request(app)
                .get("/46/v4/root/exploring-lupus")
                .expect(302)
                .then((res) => {
                    const value = res.header["location"];

                    const expected = `${NODES_URL}/dpid/46/v4/root/exploring-lupus`;
                    assert.equal(value, expected, "incorrect resolution");
                });
        });
        it("should handle a generic attestations route", async () => {
            await request(app)
                .get("/46/attestations")
                .expect(302)
                .then((res) => {
                    const value = res.header["location"];

                    const expected = `${NODES_URL}/dpid/46/attestations`;
                    assert.equal(value, expected, "incorrect resolution");
                })
                .catch((err) => {
                    if (err) {
                        assert.fail(err);
                    }
                });
        });

        it("should handle a versioned(V) generic attestations route", async () => {
            await request(app)
                .get("/46/v2/attestations")
                .expect(302)
                .then((res) => {
                    const value = res.header["location"];

                    const expected = `${NODES_URL}/dpid/46/v2/attestations`;
                    assert.equal(value, expected, "incorrect resolution");
                })
                .catch((err) => {
                    if (err) {
                        assert.fail(err);
                    }
                });
        });

        it("should handle a versioned(I) generic attestations route", async () => {
            await request(app)
                .get("/46/2/attestations")
                .expect(302)
                .then((res) => {
                    const value = res.header["location"];

                    const expected = `${NODES_URL}/dpid/46/v3/attestations`;
                    assert.equal(value, expected, "incorrect resolution");
                })
                .catch((err) => {
                    if (err) {
                        assert.fail(err);
                    }
                });
        });

        it("should handle a specific attestations route with an attestation slug", async () => {
            await request(app)
                .get("/46/attestations/scientific-manuscript")
                .expect(302)
                .then((res) => {
                    const value = res.header["location"];

                    const expected = `${NODES_URL}/dpid/46/attestations/scientific-manuscript`;
                    assert.equal(value, expected, "incorrect resolution");
                })
                .catch((err) => {
                    if (err) {
                        assert.fail(err);
                    }
                });
        });

        it("should handle a versioned(V) attestations route with an attestation slug", async () => {
            await request(app)
                .get("/46/v2/attestations/scientific-manuscript")
                .expect(302)
                .then((res) => {
                    const value = res.header["location"];

                    const expected = `${NODES_URL}/dpid/46/v2/attestations/scientific-manuscript`;
                    assert.equal(value, expected, "incorrect resolution");
                })
                .catch((err) => {
                    if (err) {
                        assert.fail(err);
                    }
                });
        });

        it("should handle a versioned(I) attestations route with an attestation slug", async () => {
            await request(app)
                .get("/46/2/attestations/scientific-manuscript")
                .expect(302)
                .then((res) => {
                    const value = res.header["location"];

                    const expected = `${NODES_URL}/dpid/46/v3/attestations/scientific-manuscript`;
                    assert.equal(value, expected, "incorrect resolution");
                })
                .catch((err) => {
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
                .then((res) => {
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
                .then((res) => {
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
                .then((res) => {
                    const value = res.header["location"];

                    const expected = `${IPFS_URL}/bafybeieo5thng4grq5aujudqtagximd2k5ucs6ale6pxoecr64pqnrxuhe/.nodeKeep`;
                    assert.equal(value, expected, "incorrect resolution");
                });
        });
    });

    describe("/api/v2/resolve", () => {
        describe("/dpid", async () => {
            it("should return history", async () => {
                await request(app)
                    .get("/api/v2/resolve/dpid/46")
                    .expect(200)
                    .expect((res) =>
                        expect(res.body).toMatchObject({
                            id: "",
                            owner: "0xF0C6957a0CaFf18D4a18E1CE99b769d20026685e",
                            manifest: "bafkreihge5qw7sc3mqc4wkf4cgpv6udtvrgipfxwyph7dhlyu6bkkt7tfq",
                            versions: expect.arrayContaining([
                                expect.objectContaining({
                                    version: "",
                                    manifest: "bafkreih5koqw5nvxucidlihwfslknj674oeuroclit74rkaqpe4mq6xuka",
                                    time: 1683222132,
                                }),
                            ]),
                        }),
                    );
            });

            it("should put the right manifest at the root if version is specified", async () => {
                await request(app)
                    .get("/api/v2/resolve/dpid/46/3")
                    .expect(200)
                    .expect((res) =>
                        expect(res.body.manifest).toEqual(
                            // fourth published CID
                            "bafkreibn3jhdlsdsonv25t7i2bwtrbkl3jzwjbnnwylpeih3jmmzdhsfmi",
                        ),
                    );
            });
        });

        describe("/codex", async () => {
            it("should return history", async () => {
                await request(app)
                    .get("/api/v2/resolve/codex/kjzl6kcym7w8y95yum398wiv3hydj2qb1xrw95jet4lax3nwio3waeiknsprols")
                    .expect(200)
                    .expect((res) =>
                        expect(res.body).toMatchObject({
                            id: "kjzl6kcym7w8y95yum398wiv3hydj2qb1xrw95jet4lax3nwio3waeiknsprols",
                            manifest: "bafkreiadq7ipg4wvc3wgebeym5wyflltsvnir5ocxygv6aqkddblz6yedi",
                            owner: "0x5249a44b2abea543b2c441ac4964a08deb3ed3cb",
                            versions: expect.arrayContaining([
                                expect.objectContaining({
                                    time: 1721138810,
                                    manifest: "bafkreiadq7ipg4wvc3wgebeym5wyflltsvnir5ocxygv6aqkddblz6yedi",
                                    version: "k3y52mos6605bnl6ftp35rba54vog7nf2ls6dd3e1b4nhne1z8rfplz82x878uyv4",
                                }),
                            ]),
                        }),
                    );
            });

            it("should accept commit ID", async () => {
                await request(app)
                    .get("/api/v2/resolve/codex/k3y52mos6605bnl6ftp35rba54vog7nf2ls6dd3e1b4nhne1z8rfplz82x878uyv4")
                    .expect(200)
                    .expect((res) =>
                        expect(res.body).toMatchObject({
                            id: "kjzl6kcym7w8y95yum398wiv3hydj2qb1xrw95jet4lax3nwio3waeiknsprols",
                            manifest: "bafkreiadq7ipg4wvc3wgebeym5wyflltsvnir5ocxygv6aqkddblz6yedi",
                            owner: "0x5249a44b2abea543b2c441ac4964a08deb3ed3cb",
                            versions: expect.arrayContaining([
                                expect.objectContaining({
                                    time: 1721138810,
                                    manifest: "bafkreiadq7ipg4wvc3wgebeym5wyflltsvnir5ocxygv6aqkddblz6yedi",
                                    version: "k3y52mos6605bnl6ftp35rba54vog7nf2ls6dd3e1b4nhne1z8rfplz82x878uyv4",
                                }),
                            ]),
                        }),
                    );
            });
        });
    });

    describe("/api/v2/query", async () => {
        describe("/history", async () => {
            const philippsNodeStreamMatcher = expect.objectContaining({
                id: "kjzl6kcym7w8y95yum398wiv3hydj2qb1xrw95jet4lax3nwio3waeiknsprols",
                manifest: "bafkreiadq7ipg4wvc3wgebeym5wyflltsvnir5ocxygv6aqkddblz6yedi",
                owner: "0x5249a44b2abea543b2c441ac4964a08deb3ed3cb",
                versions: expect.arrayContaining([
                    expect.objectContaining({
                        time: 1721138810,
                        manifest: "bafkreiadq7ipg4wvc3wgebeym5wyflltsvnir5ocxygv6aqkddblz6yedi",
                        version: "k3y52mos6605bnl6ftp35rba54vog7nf2ls6dd3e1b4nhne1z8rfplz82x878uyv4",
                    }),
                ]),
            });

            const philippsNodeLegacyMatcher = expect.objectContaining({
                // dpid not upgraded, response from legacy mapping. Hence no id, and a slightly
                // different timestamp due to tx mining
                id: "",
                manifest: "bafkreiadq7ipg4wvc3wgebeym5wyflltsvnir5ocxygv6aqkddblz6yedi",
                owner: "0x5249a44B2abEa543b2C441AC4964A08deB3Ed3CB",
                versions: expect.arrayContaining([
                    expect.objectContaining({
                        time: 1721137512,
                        manifest: "bafkreiadq7ipg4wvc3wgebeym5wyflltsvnir5ocxygv6aqkddblz6yedi",
                        version: "",
                    }),
                ]),
            });

            it("accepts stream id param", async () => {
                await request(app)
                    .get("/api/v2/query/history/kjzl6kcym7w8y95yum398wiv3hydj2qb1xrw95jet4lax3nwio3waeiknsprols")
                    .expect(200)
                    .expect((res) => expect(res.body).toEqual(expect.arrayContaining([philippsNodeStreamMatcher])));
            });

            it("accepts dpid param", async () => {
                await request(app)
                    .get("/api/v2/query/history/299")
                    .expect(200)
                    .expect((res) => expect(res.body).toEqual(expect.arrayContaining([philippsNodeLegacyMatcher])));
            });

            it("accepts streamid array body", async () => {
                await request(app)
                    .post("/api/v2/query/history")
                    .send({ ids: ["kjzl6kcym7w8y95yum398wiv3hydj2qb1xrw95jet4lax3nwio3waeiknsprols"] })
                    .expect(200)
                    .expect((res) => expect(res.body).toEqual(expect.arrayContaining([philippsNodeStreamMatcher])));
            });

            it("accepts dpid array body", async () => {
                await request(app)
                    .post("/api/v2/query/history")
                    .send({ ids: ["299"] })
                    .expect(200)
                    .expect((res) => expect(res.body).toEqual(expect.arrayContaining([philippsNodeLegacyMatcher])));
            });

            it("accepts mixed dpid and streamid array body", async () => {
                await request(app)
                    .post("/api/v2/query/history")
                    .send({ ids: ["299", "kjzl6kcym7w8y95yum398wiv3hydj2qb1xrw95jet4lax3nwio3waeiknsprols"] })
                    .expect(200)
                    .expect((res) =>
                        expect(res.body).toEqual(
                            expect.arrayContaining([philippsNodeStreamMatcher, philippsNodeLegacyMatcher]),
                        ),
                    );
            });

            it("accepts multiple dpids in array body", async () => {
                await request(app)
                    .post("/api/v2/query/history")
                    .send({ ids: ["299", "299"] })
                    .expect(200)
                    .expect((res) =>
                        expect(res.body).toEqual(
                            expect.arrayContaining([philippsNodeLegacyMatcher, philippsNodeLegacyMatcher]),
                        ),
                    );
            });

            it("accepts multiple streamids in array body", async () => {
                await request(app)
                    .post("/api/v2/query/history")
                    .send({
                        ids: [
                            "kjzl6kcym7w8y95yum398wiv3hydj2qb1xrw95jet4lax3nwio3waeiknsprols",
                            "kjzl6kcym7w8y95yum398wiv3hydj2qb1xrw95jet4lax3nwio3waeiknsprols",
                        ],
                    })
                    .expect(200)
                    .expect((res) =>
                        expect(res.body).toEqual(
                            expect.arrayContaining([philippsNodeStreamMatcher, philippsNodeStreamMatcher]),
                        ),
                    );
            });
        });

        describe("/objects", async () => {
            it("should return a list of research objects", async () => {
                await request(app)
                    .get("/api/v2/query/objects")
                    .expect(200)
                    .expect((res: { body: Awaited<ReturnType<typeof getCodexHistory>>[] }) => {
                        expect(Array.isArray(res.body)).toBe(true);
                        expect(res.body.length).toBeGreaterThan(800);

                        res.body.forEach((obj) => {
                            expect(obj).toEqual(
                                expect.objectContaining({
                                    id: expect.any(String),
                                    version: expect.any(String),
                                    owner: expect.any(String),
                                    manifest: expect.any(String),
                                    title: expect.any(String),
                                    // license is optional in the model
                                    ...((obj as ResearchObject).license ? { license: expect.any(String) } : {}),
                                }),
                            );
                        });
                    });
            });
        });
    });
});
