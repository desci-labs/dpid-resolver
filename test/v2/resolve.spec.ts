import { describe, expect, it } from "vitest";
import { createRequire } from "module";
import { app } from "../../src/index.js";
import type { TestResponse } from "../testUtils.js";

// Use createRequire to import CommonJS supertest in ESM environment
const require = createRequire(import.meta.url);
const request = require("supertest");

describe("/api/v2/resolve", { timeout: 10_000 }, () => {
    describe("/dpid", async () => {
        it("should return history", async () => {
            await request(app)
                .get("/api/v2/resolve/dpid/46")
                .expect(200)
                .expect((res: TestResponse) =>
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
                .expect((res: TestResponse) =>
                    expect((res.body as { manifest: string }).manifest).toEqual(
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
                .expect((res: TestResponse) =>
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
                .expect((res: TestResponse) =>
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
