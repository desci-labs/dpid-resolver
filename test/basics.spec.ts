import request from "supertest";
import { describe, it } from "mocha";
import { app } from "../src/index";
import assert from "assert";

describe("dPID resolution", function () {
    this.timeout(3000);
    describe("web resolution (for humans)", () => {
        it("should handle a plain dpid", async () => {
            await request(app)
                .get("/46")
                .expect(302)
                .then((res) => {
                    const value = res.header["location"];

                    const expected = "https://nodes.desci.com/dpid/46";
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

                    const expected = "https://nodes.desci.com/dpid/46/v1";

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

                    const expected = "https://nodes.desci.com/dpid/46/v4";
                    assert.equal(value, expected, "incorrect resolution");
                });
        });

        it("should handle a 0-indexed versioned dpid", async () => {
            await request(app)
                .get("/46/0")
                .expect(302)
                .then((res) => {
                    const value = res.header["location"];

                    const expected = "https://nodes.desci.com/dpid/46/v1";
                    assert.equal(value, expected, "incorrect resolution");
                });
        });
        it("should handle a higher 0-indexed versioned dpid", async () => {
            await request(app)
                .get("/46/2")
                .expect(302)
                .then((res) => {
                    const value = res.header["location"];

                    const expected = "https://nodes.desci.com/dpid/46/v3";
                    assert.equal(value, expected, "incorrect resolution");
                });
        });
    });
    describe("raw resolution (for machines)", () => {
        it("should handle a versioned raw dpid", async () => {
            await request(app)
                .get("/46/v4?raw")
                .expect(302)
                .then((res) => {
                    const value = res.header["location"];

                    const expected =
                        "https://ipfs.desci.com/ipfs/bafkreibn3jhdlsdsonv25t7i2bwtrbkl3jzwjbnnwylpeih3jmmzdhsfmi";
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

                    const expected =
                        "https://ipfs.desci.com/ipfs/bafkreihge5qw7sc3mqc4wkf4cgpv6udtvrgipfxwyph7dhlyu6bkkt7tfq";
                    assert.equal(value, expected, "incorrect resolution");
                });
        });

        it("should handle a dPID path", async () => {
            await request(app).get("/46/v4/root?raw").expect(200);
        });

        it("should handle a dPID path subfolder", async () => {
            await request(app).get("/46/v4/root/exploring-lupus?raw").expect(200);
        });

        it("should handle a dPID path to file", async () => {
            await request(app)
                .get("/46/v4/root/.nodeKeep?raw")
                .expect(302)
                .then((res) => {
                    const value = res.header["location"];

                    const expected =
                        "https://ipfs.desci.com/ipfs/bafybeidmian2ksjtidvpghzy6iesvcjs5pd647q3rtj6znu26vr5g6axy4/.nodeKeep";
                    assert.equal(value, expected, "incorrect resolution");
                });
        });
    });
});
