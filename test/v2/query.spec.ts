import { describe, expect, it } from "vitest";
import { createRequire } from "module";
import { app } from "../../src/index.js";
import type { getCodexHistory } from "../../src/api/v2/queries/history.js";
import type { TestResponse } from "../testUtils.js";

// Use createRequire to import CommonJS supertest in ESM environment
const require = createRequire(import.meta.url);
const request = require("supertest");

type ResearchObject = Awaited<ReturnType<typeof getCodexHistory>> & {
    license?: string;
};

describe("/api/v2/query", { timeout: 10_000 }, async () => {
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
                .expect((res: TestResponse) =>
                    expect(res.body).toEqual(expect.arrayContaining([philippsNodeStreamMatcher])),
                );
        });

        it("accepts dpid param", async () => {
            await request(app)
                .get("/api/v2/query/history/299")
                .expect(200)
                .expect((res: TestResponse) =>
                    expect(res.body).toEqual(expect.arrayContaining([philippsNodeLegacyMatcher])),
                );
        });

        it("accepts streamid array body", async () => {
            await request(app)
                .post("/api/v2/query/history")
                .send({ ids: ["kjzl6kcym7w8y95yum398wiv3hydj2qb1xrw95jet4lax3nwio3waeiknsprols"] })
                .expect(200)
                .expect((res: TestResponse) =>
                    expect(res.body).toEqual(expect.arrayContaining([philippsNodeStreamMatcher])),
                );
        });

        it("accepts dpid array body", async () => {
            await request(app)
                .post("/api/v2/query/history")
                .send({ ids: ["299"] })
                .expect(200)
                .expect((res: TestResponse) =>
                    expect(res.body).toEqual(expect.arrayContaining([philippsNodeLegacyMatcher])),
                );
        });

        it("accepts mixed dpid and streamid array body", async () => {
            await request(app)
                .post("/api/v2/query/history")
                .send({ ids: ["299", "kjzl6kcym7w8y95yum398wiv3hydj2qb1xrw95jet4lax3nwio3waeiknsprols"] })
                .expect(200)
                .expect((res: TestResponse) =>
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
                .expect((res: TestResponse) =>
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
                .expect((res: TestResponse) =>
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

    describe("/owner", async () => {
        const testOwnerId = "0x5249a44b2abea543b2c441ac4964a08deb3ed3cb";

        it("should return research objects filtered by owner address", async () => {
            await request(app)
                .get(`/api/v2/query/owner/${testOwnerId}`)
                .expect(200)
                .expect((res: { body: Awaited<ReturnType<typeof getCodexHistory>>[] }) => {
                    expect(Array.isArray(res.body)).toBe(true);
                    expect(res.body.length).toBeGreaterThan(0);

                    res.body.forEach((obj) => {
                        // Check that each object has the correct owner
                        // Owner can be in format: did:pkh:eip155:1337:0x... or just 0x...
                        const ownerMatches =
                            obj.owner === testOwnerId ||
                            obj.owner.toLowerCase().endsWith(testOwnerId.toLowerCase());
                        expect(ownerMatches).toBe(true);

                        // Validate object structure
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

        it("should return empty array for owner with no research objects", async () => {
            const nonExistentOwner = "0x0000000000000000000000000000000000000000";
            await request(app)
                .get(`/api/v2/query/owner/${nonExistentOwner}`)
                .expect(200)
                .expect((res: { body: unknown[] }) => {
                    expect(Array.isArray(res.body)).toBe(true);
                    expect(res.body.length).toBe(0);
                });
        });

        it("should return 400 when owner id is missing", async () => {
            await request(app)
                .get("/api/v2/query/owner/")
                .expect(400)
                .expect((res: { body: { error: string; details: string } }) => {
                    expect(res.body.error).toBe("invalid request");
                    expect(res.body.details).toBe("missing owner id in path parameter");
                });
        });
    });

    describe("/reverse", async () => {
        // Test cases: streamId -> expected dpid
        const testCases = [
            { streamId: "kjzl6kcym7w8y4wtsd58uddhneivpls194lic15ggrq6iwu7mxzdyper49oegxr", dpid: 574 },
            { streamId: "kjzl6kcym7w8y4w35x7lhqxfibrbz76lfkhkkc6ijsmz2vb9roz7753r7rt6cl6", dpid: 989 },
            { streamId: "kjzl6kcym7w8y4xc7wkce7iseqnpps33o3cx70zq7txqofaxkqkfw8bjsceh6nd", dpid: 786 },
        ];

        it("should return DPID for valid stream ID (574)", async () => {
            const { streamId, dpid } = testCases[0];
            await request(app)
                .get(`/api/v2/query/reverse/${streamId}`)
                .expect(200)
                .expect((res: TestResponse) => {
                    expect(res.body).toEqual(
                        expect.objectContaining({
                            dpid,
                            streamId,
                            links: expect.objectContaining({
                                resolve: expect.stringContaining(`/api/v2/resolve/dpid/${dpid}`),
                                history: expect.stringContaining(`/api/v2/query/history/${dpid}`),
                            }),
                        }),
                    );
                });
        });

        it("should return DPID for valid stream ID (989)", async () => {
            const { streamId, dpid } = testCases[1];
            await request(app)
                .get(`/api/v2/query/reverse/${streamId}`)
                .expect(200)
                .expect((res: TestResponse) => {
                    expect(res.body).toEqual(
                        expect.objectContaining({
                            dpid,
                            streamId,
                            links: expect.objectContaining({
                                resolve: expect.stringContaining(`/api/v2/resolve/dpid/${dpid}`),
                                history: expect.stringContaining(`/api/v2/query/history/${dpid}`),
                            }),
                        }),
                    );
                });
        });

        it("should return DPID for valid stream ID (786)", async () => {
            const { streamId, dpid } = testCases[2];
            await request(app)
                .get(`/api/v2/query/reverse/${streamId}`)
                .expect(200)
                .expect((res: TestResponse) => {
                    expect(res.body).toEqual(
                        expect.objectContaining({
                            dpid,
                            streamId,
                            links: expect.objectContaining({
                                resolve: expect.stringContaining(`/api/v2/resolve/dpid/${dpid}`),
                                history: expect.stringContaining(`/api/v2/query/history/${dpid}`),
                            }),
                        }),
                    );
                });
        });

        it("should return 404 for non-existent stream ID", async () => {
            const nonExistentStreamId = "kjzl6kcym7w8y0000000000000000000000000000000000000000000000000000";
            await request(app)
                .get(`/api/v2/query/reverse/${nonExistentStreamId}`)
                .expect(404)
                .expect((res: TestResponse) => {
                    expect(res.body).toEqual(
                        expect.objectContaining({
                            error: "not found",
                            details: expect.stringContaining("no DPID found for stream ID"),
                        }),
                    );
                });
        });

        it("should return 400 when stream ID is missing", async () => {
            await request(app)
                .get("/api/v2/query/reverse/")
                .expect(400)
                .expect((res: TestResponse) => {
                    expect(res.body).toEqual(
                        expect.objectContaining({
                            error: "invalid request",
                            details: "missing stream ID in path parameter",
                        }),
                    );
                });
        });
    });
});
