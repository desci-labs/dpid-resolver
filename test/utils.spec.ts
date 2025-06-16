import { describe, it, expect } from "vitest";
import { isDpid, isVersionString } from "../src/util/validation.js";
import { cleanupEip155Address } from "../src/util/conversions.js";

describe("Utility Functions", () => {
    describe("isDpid", () => {
        it("should return true for valid numeric DPIDs", () => {
            expect(isDpid("123")).toBe(true);
            expect(isDpid("0")).toBe(true);
            expect(isDpid("999999")).toBe(true);
        });

        it("should return false for non-numeric strings", () => {
            expect(isDpid("abc")).toBe(false);
            expect(isDpid("123abc")).toBe(false);
            expect(isDpid("")).toBe(false);
        });
    });

    describe("isVersionString", () => {
        it("should return true for valid version strings", () => {
            expect(isVersionString("0")).toBe(true);
            expect(isVersionString("1")).toBe(true);
            expect(isVersionString("v1")).toBe(true);
            expect(isVersionString("v11")).toBe(true);
        });

        it("should return false for invalid version strings", () => {
            expect(isVersionString("")).toBe(false);
            expect(isVersionString("version")).toBe(false);
            expect(isVersionString("v2.0")).toBe(false);
            expect(isVersionString("v")).toBe(false);
        });
    });

    describe("cleanupEip155Address", () => {
        it("should remove did:pkh:eip155 prefix and chainId", () => {
            expect(cleanupEip155Address("did:pkh:eip155:1:0x123")).toBe("0x123");
            expect(cleanupEip155Address("did:pkh:eip155:137:0xabc")).toBe("0xabc");
        });

        it("should return the original string if no prefix is present", () => {
            expect(cleanupEip155Address("0x123")).toBe("0x123");
            expect(cleanupEip155Address("abc")).toBe("abc");
        });
    });
});
