import { describe, expect, it } from "vitest";
import { createRequire } from "module";
import { app } from "../../src/index.js";
import type { getCodexHistory } from "../../src/api/v2/queries/history.js";

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
});
